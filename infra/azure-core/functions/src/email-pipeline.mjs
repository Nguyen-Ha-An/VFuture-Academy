import { createCipheriv,createDecipheriv,hkdfSync,randomBytes } from 'node:crypto';
import { CONTINUE,eventKeys } from './core.mjs';
export const OTP_TTL_MS=240000;
export const CALLBACK_BUDGET_MS=1700;
const aad=Buffer.from('vfuture-academy/email-otp/v1');
export function validateEmailSecret(secret){
  if(typeof secret!=='string'||secret.length<32||secret.trimStart().startsWith('@Microsoft.KeyVault('))throw new Error('invalid_email_secret');
  return secret;
}
const keyFor=secret=>Buffer.from(hkdfSync('sha256',validateEmailSecret(secret),aad,'encrypted-queue-payload',32));
export function sealOtp(payload,secret){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFor(secret),nonce);cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
}
export function openOtp(envelope,secret,now=Date.now()){
  const item=typeof envelope==='string'?JSON.parse(envelope):envelope;
  if(item?.v!==1||typeof item.ciphertext!=='string'||item.ciphertext.length>12000)throw new Error('invalid_envelope');
  const decipher=createDecipheriv('aes-256-gcm',keyFor(secret),Buffer.from(item.nonce,'base64'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(item.tag,'base64'));
  const decoded=JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  if(!Number.isSafeInteger(decoded.createdAt)||!Number.isSafeInteger(decoded.expiresAt)||decoded.expiresAt-decoded.createdAt!==OTP_TTL_MS||decoded.createdAt>now+5000||decoded.expiresAt<=now||!Number.isInteger(decoded.queueAttempts)||decoded.queueAttempts<0||decoded.queueAttempts>8)throw new Error('expired_or_invalid_envelope');
  const keys=eventKeys(decoded.event,secret);
  if(keys.event!==decoded.keys?.event||keys.recipient!==decoded.keys?.recipient||keys.requestId!==decoded.keys?.requestId)throw new Error('event_binding_mismatch');
  return decoded;
}
export async function boundedCallback(operation,{budgetMs=CALLBACK_BUDGET_MS}={}){
  const controller=new AbortController();let timer;
  try{return await Promise.race([operation(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('callback_deadline'));},budgetMs);})]);}
  finally{clearTimeout(timer);}
}
export async function acceptOtp(event,{secret,enqueue,signal,now=()=>Date.now()}){
  signal?.throwIfAborted();
  const createdAt=now(),keys=eventKeys(event,secret);
  const payload={event,keys,createdAt,expiresAt:createdAt+OTP_TTL_MS,queueAttempts:0};
  await enqueue('email-otp',sealOtp(payload,secret),{ttlSeconds:OTP_TTL_MS/1000,signal});
  return CONTINUE; // Queue acceptance only; never a delivered-message assertion.
}
const finalStates=new Set(['submitted','sent','delivered','delivery_failed','failed','expired','rate_limited']);
export async function processOtp(envelope,{secret,store,send,enqueue,now=()=>Date.now()}){
  let payload;
  try{payload=openOtp(envelope,secret,now());}catch{return{status:'discarded'};}
  const {keys,event}=payload;
  const retry=async()=>{
    if(payload.queueAttempts>=8||payload.expiresAt<=now()+10000){await store.transition(keys.event,'expired');return{status:'expired'};}
    const next={...payload,queueAttempts:payload.queueAttempts+1};
    await enqueue('email-otp',sealOtp(next,secret),{ttlSeconds:Math.max(1,Math.floor((payload.expiresAt-now())/1000)),visibilitySeconds:10});
    return{status:'retry_queued'};
  };
  try{
    const row=await store.acquire(payload,now());
    if(!row)return retry();
    if(finalStates.has(row.status))return{status:row.status};
    if(row.expiresAtMs<=now()){await store.transition(keys.event,'expired');return{status:'expired'};}
    if(row.attempts>=3){await store.transition(keys.event,'failed');return{status:'failed'};}
    if(!row.rateApproved){
      try{await store.rateLimit(keys.recipient,now(),5);await store.rateLimit('global',now(),100);}
      catch{await store.transition(keys.event,'rate_limited');return{status:'rate_limited'};}
      await store.patch(keys.event,{rateApproved:true});
    }
    await store.patch(keys.event,{attempts:row.attempts+1});
    // The operation mapping exists before submission, so early delivery events cannot be misbound.
    await store.mapOperation(keys.requestId,keys.event,keys.recipient);
    if(Math.min(payload.expiresAt,row.expiresAtMs)<=now()){await store.transition(keys.event,'expired');return{status:'expired'};}
    try{await send(event,{requestId:keys.requestId,firstSent:row.firstSent,expiresAt:Math.min(payload.expiresAt,row.expiresAtMs)});}
    catch(error){
      if(error.status===410){await store.transition(keys.event,'expired');return{status:'expired'};}
      // Poll known operation ID after ambiguous timeout/409 before another submission.
      if(error.ambiguous||error.status===409){
        await store.transition(keys.event,'submitted',{operationId:keys.requestId,submissionUncertain:true});
        try{await enqueue('email-status',JSON.stringify({eventKey:keys.event,operationId:keys.requestId,attempt:0}),{ttlSeconds:3600,visibilitySeconds:10});}catch{await store.patch(keys.event,{sendStatus:'unknown'});}
        return{status:'submitted_unknown'};
      }
      if(![408,429,500,502,503,504].includes(error.status)||row.attempts+1>=3){await store.transition(keys.event,'failed');return{status:'failed'};}
      await store.release(keys.event);
      return retry();
    }
    await store.transition(keys.event,'submitted',{operationId:keys.requestId});
    try{await enqueue('email-status',JSON.stringify({eventKey:keys.event,operationId:keys.requestId,attempt:0}),{ttlSeconds:3600,visibilitySeconds:10});}catch{await store.patch(keys.event,{sendStatus:'unknown'});}
    return{status:'submitted'};
  }catch{
    // Retry encrypted work with its original expiry. No raw dependency errors escape to host logs.
    try{return await retry();}catch{return{status:'worker_unavailable'};}
  }
}
export async function processStatus(message,{store,poll,enqueue}){
  const item=typeof message==='string'?JSON.parse(message):message;
  if(!/^[a-f0-9]{64}$/.test(item?.eventKey??'')||!/^[a-f0-9-]{36}$/.test(item.operationId??'')||!Number.isInteger(item.attempt)||item.attempt<0||item.attempt>12)return{status:'discarded'};
  const mapping=await store.operation(item.operationId);
  if(!mapping||mapping.eventKey!==item.eventKey)return{status:'discarded'};
  let status;try{status=await poll(item.operationId);}catch{status='Unknown';}
  if(status==='Succeeded'){await store.transition(item.eventKey,'sent');return{status:'sent'};}
  if(['Failed','Canceled'].includes(status)){await store.transition(item.eventKey,'failed');return{status:'failed'};}
  if(item.attempt>=12){await store.patch(item.eventKey,{sendStatus:'unknown'});return{status:'send_unknown'};}
  await enqueue('email-status',JSON.stringify({...item,attempt:item.attempt+1}),{ttlSeconds:3600,visibilitySeconds:10});
  return{status:'poll_queued'};
}
export async function processDelivery(message,{store,secret,acsResourceId}){
  const events=typeof message==='string'?JSON.parse(message):message;
  for(const event of Array.isArray(events)?events:[events]){
    if(event?.eventType!=='Microsoft.Communication.EmailDeliveryReportReceived'||String(event.topic).toLowerCase()!==acsResourceId.toLowerCase())continue;
    const data=event.data;
    if(!/^[a-f0-9-]{36}$/i.test(data?.messageId??'')||typeof data.recipient!=='string')continue;
    const mapping=await store.operation(data.messageId);
    const recipient=eventKeys({email:data.recipient,code:'',correlationId:''},secret).recipient;
    if(!mapping||mapping.recipientKey!==recipient)continue;
    if(data.status==='Delivered')await store.transition(mapping.eventKey,'delivered',{deliveryStatus:'Delivered'});
    else if(['Suppressed','Bounced','Quarantined','FilteredSpam','Expanded','Failed'].includes(data.status))await store.transition(mapping.eventKey,'delivery_failed',{deliveryStatus:data.status});
  }
  return{status:'delivery_report_processed'};
}

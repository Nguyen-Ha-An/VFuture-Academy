import { eventKeys } from './core.mjs';
const terminal=new Set(['delivered','delivery_failed']);
export function otpStore(table){
  const get=key=>table.getEntity('otp',key);
  const mutate=async(key,change)=>{
    for(let i=0;i<4;i++){
      const row=await get(key);const update=change(row);if(!update)return row;
      try{await table.updateEntity({...row,...update},'Replace',{etag:row.etag});return{...row,...update};}
      catch(error){if(error.statusCode!==412)throw new Error('state_unavailable');}
    }throw new Error('state_conflict');
  };
  return{
    async acquire(payload,now){
      try{await table.createEntity({partitionKey:'otp',rowKey:payload.keys.event,status:'accepted',attempts:0,rateApproved:false,leaseUntil:0,firstSent:new Date(payload.createdAt).toUTCString(),acceptedAt:new Date(payload.createdAt).toISOString(),expiresAtMs:payload.expiresAt,expiresAt:new Date(now+86400000).toISOString()});}catch(error){if(error.statusCode!==409)throw new Error('state_unavailable');}
      let acquired=false;
      const row=await mutate(payload.keys.event,current=>{
        acquired=false;
        if(['submitted','sent','delivered','delivery_failed','failed','expired','rate_limited'].includes(current.status)){acquired=true;return null;}
        if(Number(current.leaseUntil)>now)return null;
        acquired=true;return{leaseUntil:now+60000,status:'processing'};
      });return acquired?row:null;
    },
    patch:(key,patch)=>mutate(key,()=>patch),
    release:key=>mutate(key,row=>terminal.has(row.status)||row.status==='sent'||row.status==='submitted'?null:({leaseUntil:0,status:'accepted'})),
    transition:(key,status,patch={})=>mutate(key,row=>{
      if(terminal.has(row.status))return null;
      if(row.status==='submitted'&&['accepted','processing','expired','rate_limited'].includes(status))return null;
      if(row.status==='sent'&&['accepted','processing','submitted','failed'].includes(status))return null;
      return{status,...patch,leaseUntil:0,updatedAt:new Date().toISOString()};
    }),
    async mapOperation(operationId,eventKey,recipientKey){
      try{await table.createEntity({partitionKey:'operations',rowKey:operationId,eventKey,recipientKey,expiresAt:new Date(Date.now()+86400000).toISOString()});}
      catch(error){if(error.statusCode!==409)throw new Error('state_unavailable');const old=await table.getEntity('operations',operationId);if(old.eventKey!==eventKey||old.recipientKey!==recipientKey)throw new Error('operation_collision');}
    },
    async operation(operationId){try{return await table.getEntity('operations',operationId);}catch(error){if(error.statusCode===404)return null;throw new Error('state_unavailable');}},
    async rateLimit(recipient,now,limit){
      const rowKey=`${recipient}-${Math.floor(now/60000)}`;
      for(let i=0;i<8;i++){
        try{
          let row;try{row=await table.getEntity('rates',rowKey);}catch(error){if(error.statusCode!==404)throw error;}
          if(!row)await table.createEntity({partitionKey:'rates',rowKey,count:1,expiresAt:new Date(now+86400000).toISOString()});
          else{if(Number(row.count)>=limit)throw new Error('rate_limited');await table.updateEntity({...row,count:Number(row.count)+1},'Replace',{etag:row.etag});}
          return;
        }catch(error){if(![409,412].includes(error.statusCode))throw new Error('rate_limited_or_unavailable');await new Promise(resolve=>setTimeout(resolve,Math.min(500,10*2**i)+Math.random()*20));}
      }throw new Error('rate_conflict');
    }
  };
}
export function queueTransport({endpoint,credential,fetcher=fetch}){
  const root=new URL(endpoint);
  if(root.protocol!=='https:'||!root.hostname.endsWith('.queue.core.windows.net'))throw new Error('invalid_queue_endpoint');
  return async(name,message,{ttlSeconds,visibilitySeconds=0,signal}={})=>{
    if(!['email-otp','email-status'].includes(name)||!Number.isInteger(ttlSeconds)||ttlSeconds<=0||ttlSeconds>3600)throw new Error('invalid_queue_message');
    signal?.throwIfAborted();
    const token=await credential.getToken('https://storage.azure.com/.default',{abortSignal:signal});
    signal?.throwIfAborted();
    const url=new URL(`${name}/messages`,root);url.searchParams.set('messagettl',String(ttlSeconds));url.searchParams.set('visibilitytimeout',String(visibilitySeconds));
    const escaped=message.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const response=await fetcher(url,{method:'POST',headers:{authorization:`Bearer ${token.token}`,'x-ms-version':'2023-11-03','x-ms-date':new Date().toUTCString(),'content-type':'application/xml'},body:`<QueueMessage><MessageText>${escaped}</MessageText></QueueMessage>`,signal:signal??AbortSignal.timeout(3000),redirect:'error'});
    if(response.status!==201)throw new Error('queue_unavailable');
  };
}
export function acsTransport({endpoint,sender,credential,fetcher=fetch}){
  const root=new URL(endpoint);
  if(root.protocol!=='https:'||!root.hostname.endsWith('.communication.azure.com'))throw new Error('invalid_acs_endpoint');
  const token=()=>credential.getToken('https://communication.azure.com/.default');
  return{
    async send(event,{requestId,firstSent,expiresAt}){
      let response,auth;
      try{auth=await token();}catch{throw Object.assign(new Error('credential_unavailable'),{status:503});}
      if(expiresAt<=Date.now())throw Object.assign(new Error('otp_expired'),{status:410});
      try{response=await fetcher(new URL('/emails:send?api-version=2023-03-31',root),{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.min(5000,Math.max(1,expiresAt-Date.now()))),headers:{authorization:`Bearer ${auth.token}`,'content-type':'application/json','Operation-Id':requestId,'Repeatability-Request-ID':requestId,'Repeatability-First-Sent':firstSent},body:JSON.stringify({senderAddress:sender,recipients:{to:[{address:event.email}]},content:{subject:'Your VFuture Academy verification code',plainText:`Your VFuture Academy verification code is ${event.code}. Use it only on the VFuture Academy sign-in page. Do not share this code.`}})});}
      catch{throw Object.assign(new Error('submission_unknown'),{ambiguous:true});}
      if(response.status!==202)throw Object.assign(new Error('acs_rejected'),{status:response.status});
      const result=await response.json();if(result.id?.toLowerCase()!==requestId.toLowerCase())throw Object.assign(new Error('operation_mismatch'),{ambiguous:true});
    },
    async poll(operationId){
      const auth=await token();const response=await fetcher(new URL(`/emails/operations/${operationId}?api-version=2023-03-31`,root),{headers:{authorization:`Bearer ${auth.token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
      if(response.status===404)return'Unknown';if(!response.ok)throw new Error('status_unavailable');
      const data=await response.json();return['Succeeded','Failed','Canceled','Running','NotStarted'].includes(data.status)?data.status:'Unknown';
    }
  };
}
export const recipientHash=(email,secret)=>eventKeys({email,code:'',correlationId:''},secret).recipient;

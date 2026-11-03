import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptOtp,openOtp,processOtp,processStatus,processDelivery,boundedCallback,OTP_TTL_MS,CALLBACK_BUDGET_MS } from '../functions/src/email-pipeline.mjs';
import { otpStore,queueTransport,acsTransport } from '../functions/src/email-runtime.mjs';
import { eventKeys } from '../functions/src/core.mjs';
const secret='test-random-secret-'.repeat(4);
const event={email:'learner@example.com',code:'12345678',correlationId:'11111111-2222-3333-4444-555555555555'};
class MemoryTable{
  rows=new Map();version=0;
  async createEntity(row){const key=`${row.partitionKey}/${row.rowKey}`;if(this.rows.has(key))throw{statusCode:409};this.rows.set(key,{...row,etag:String(++this.version)});}
  async getEntity(p,r){const row=this.rows.get(`${p}/${r}`);if(!row)throw{statusCode:404};return structuredClone(row);}
  async updateEntity(row,_mode,{etag}={}){const key=`${row.partitionKey}/${row.rowKey}`;if(etag&&this.rows.get(key)?.etag!==etag)throw{statusCode:412};this.rows.set(key,{...row,etag:String(++this.version)});}
}
function harness(){
  const table=new MemoryTable(),store=otpStore(table),queue=[],sent=[];let clock=Date.now();
  const enqueue=async(name,message,options)=>queue.push({name,message,options});
  return{table,store,queue,sent,enqueue,now:()=>clock,advance:ms=>{clock+=ms;},send:async(e,meta)=>sent.push({event:e,meta})};
}
async function accepted(h,e=event){await acceptOtp(e,{secret,enqueue:h.enqueue,now:h.now});const index=h.queue.findIndex(item=>item.name==='email-otp');return h.queue.splice(index,1)[0].message;}
test('receiver durably queues only authenticated ciphertext with strict TTL; ACK is acceptance only',async()=>{
  const h=harness();const message=await accepted(h);const envelope=JSON.parse(message);
  assert.deepEqual(Object.keys(envelope),['v','nonce','tag','ciphertext']);assert.equal(message.includes(event.email),false);assert.equal(message.includes(event.code),false);
  const payload=openOtp(message,secret,h.now());assert.deepEqual(payload.event,event);assert.equal(payload.expiresAt-payload.createdAt,OTP_TTL_MS);assert.equal(h.sent.length,0);
  assert.throws(()=>openOtp(message,secret,h.now()+OTP_TTL_MS));assert.throws(()=>openOtp(message,'wrong-secret',h.now()));
  envelope.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>openOtp(envelope,secret,h.now()));
  await assert.rejects(acceptOtp(event,{secret,enqueue:async()=>{throw Error('queue_down');},now:h.now}));
});
test('callback budget aborts hung dependencies before the2000ms Entra limit',async()=>{
  assert.ok(CALLBACK_BUDGET_MS<2000);let aborted=false;const start=performance.now();
  await assert.rejects(boundedCallback(signal=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;})),{budgetMs:30}));
  assert.equal(aborted,true);assert.ok(performance.now()-start<200);
});
test('concurrent duplicate jobs send once and never store plaintext OTP/recipient',async()=>{
  const h=harness(),message=await accepted(h),deps={...h,secret};
  await Promise.all([processOtp(message,deps),processOtp(message,deps)]);
  await processOtp(message,deps);assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].event,event);
  const rows=JSON.stringify([...h.table.rows.values()]);assert.equal(rows.includes(event.code),false);assert.equal(rows.includes(event.email),false);
});
test('worker caps durable recipient rate and retries using identical ACSoperation/repeatability IDs',async()=>{
  const h=harness();let calls=0;const seen=[];
  const send=async(e,m)=>{seen.push({e,m});calls++;throw{status:503};};
  let message=await accepted(h);
  for(let i=0;i<3;i++){await processOtp(message,{...h,secret,send});h.advance(11000);const next=h.queue.find(q=>q.name==='email-otp');if(next){h.queue.splice(h.queue.indexOf(next),1);message=next.message;}}
  assert.equal(calls,3);assert.deepEqual(seen[0],seen[2]);await processOtp(message,{...h,secret,send});assert.equal(calls,3);
  const limited=harness();for(let i=0;i<6;i++){const msg=await accepted(limited,{...event,code:`1234567${i}`});await processOtp(msg,{...limited,secret});}
  assert.equal(limited.sent.length,5);
});
test('ambiguous submission polls instead of resending; delivery updates bind resource, operation and recipient',async()=>{
  const h=harness(),message=await accepted(h);let calls=0;
  await processOtp(message,{...h,secret,send:async()=>{calls++;throw{ambiguous:true};}});
  await processOtp(message,{...h,secret,send:async()=>{calls++;}});assert.equal(calls,1);
  const status=h.queue.find(q=>q.name==='email-status').message;
  await processStatus(status,{store:h.store,enqueue:h.enqueue,poll:async()=> 'Succeeded'});
  const keys=eventKeys(event,secret),get=()=>h.table.getEntity('otp',keys.event);
  assert.equal((await get()).status,'sent');
  const report={eventType:'Microsoft.Communication.EmailDeliveryReportReceived',topic:'/acs',data:{messageId:keys.requestId,recipient:'other@example.com',status:'Delivered'}};
  await processDelivery(report,{store:h.store,secret,acsResourceId:'/acs'});assert.equal((await get()).status,'sent');
  report.data.recipient=event.email;report.topic='/other-acs';await processDelivery(report,{store:h.store,secret,acsResourceId:'/acs'});assert.equal((await get()).status,'sent');
  report.topic='/acs';await processDelivery(report,{store:h.store,secret,acsResourceId:'/acs'});assert.equal((await get()).status,'delivered');
  await processStatus(status,{store:h.store,enqueue:h.enqueue,poll:async()=> 'Failed'});assert.equal((await get()).status,'delivered');
});
test('queue REST uses finite TTL, caller cancellation and no plaintext in durable message',async()=>{
  const h=harness(),message=await accepted(h),calls=[];
  const enqueue=queueTransport({endpoint:'https://example.queue.core.windows.net/',credential:{getToken:async()=>({token:'secret-token'})},fetcher:async(url,options)=>{calls.push({url,options});return{status:201};}});
  const signal=new AbortController().signal;await enqueue('email-otp',message,{ttlSeconds:240,signal});
  assert.equal(calls[0].url.searchParams.get('messagettl'),'240');assert.equal(calls[0].options.signal,signal);assert.equal(calls[0].options.body.includes(event.email),false);
});

test('OTP expiry is rechecked after durable-state work and after credential acquisition',async()=>{
  const h=harness(),message=await accepted(h),originalMap=h.store.mapOperation;
  h.store.mapOperation=async(...args)=>{await originalMap(...args);h.advance(OTP_TTL_MS+1);};
  assert.equal((await processOtp(message,{...h,secret})).status,'expired');assert.equal(h.sent.length,0);
  let fetches=0;const transport=acsTransport({endpoint:'https://example.communication.azure.com',sender:'noreply@example.com',credential:{getToken:async()=>({token:'private'})},fetcher:async()=>{fetches++;return{status:202,json:async()=>({})};}});
  await assert.rejects(transport.send(event,{requestId:'11111111-2222-4333-8444-555555555555',firstSent:new Date().toUTCString(),expiresAt:Date.now()-1}));assert.equal(fetches,0);
});

test('25distinct learners survive global-counter contention without violating the cap',async()=>{
  const h=harness(),messages=[];
  for(let i=0;i<25;i++)messages.push(await accepted(h,{...event,email:`learner${i}@example.com`}));
  await Promise.all(messages.map(message=>processOtp(message,{...h,secret})));
  assert.equal(h.sent.length,25);
});
test('an unresolved Key Vault reference or short secret cannot enqueue OTP material', async()=>{
  for(const bad of ['short','@Microsoft.KeyVault(SecretUri=https://example.vault.azure.net/secrets/email-dedupe)']){
    const h=harness();await assert.rejects(acceptOtp(event,{secret:bad,enqueue:h.enqueue,now:h.now}));assert.equal(h.queue.length,0);
  }
});

import { acceptOtp,boundedCallback,processOtp,processStatus,processDelivery,validateEmailSecret } from './email-pipeline.mjs';
import { otpStore,queueTransport,acsTransport } from './email-runtime.mjs';
import { createHash } from 'node:crypto';
import { costAlerts, collectCosts } from './cost-monitor.mjs';
import { app } from '@azure/functions';
import { ManagedIdentityCredential } from '@azure/identity';
import { TableClient } from '@azure/data-tables';
import { extensionKeys, verifyExtensionToken } from './auth.mjs';
import { parseEvent, sweep, SCHEDULE } from './core.mjs';

const required = name => { const value = process.env[name]; if (!value) throw new Error(`Missing configuration: ${name}`); return value; };
const credential = new ManagedIdentityCredential({ clientId: required('AZURE_CLIENT_ID') });
const table = new TableClient(required('EMAIL_STATE_TABLE_URL'), 'EmailState', credential, { retryOptions: { maxRetries: 2 } });
const config = { tenantId: required('ENTRA_EXTENSION_TENANT_ID'), issuer: required('ENTRA_EXTENSION_ISSUER'), audience: required('ENTRA_EXTENSION_AUDIENCE'), extensionId: required('ENTRA_EXTENSION_ID'), clientId: required('ENTRA_CLIENT_ID') };
const jwks = extensionKeys(config);
const store = {
  async claim(rowKey, firstSent) {
    try { await table.createEntity({ partitionKey: 'events', rowKey, status: 'pending', firstSent, expiresAt: new Date(Date.now() + 86400000).toISOString() }); return true; }
    catch (error) { if (error.statusCode === 409) return false; throw new Error('state_unavailable'); }
  },
  get: rowKey => table.getEntity('events', rowKey),
  finish: (rowKey, status) => table.updateEntity({ partitionKey: 'events', rowKey, status }, 'Merge'),
  async rateLimit(recipient, now, limit) {
    const rowKey = `${recipient}-${Math.floor(now / 60000)}`;
    for (let i = 0; i < 4; i++) {
      try {
        let old;
        try { old = await table.getEntity('rates', rowKey); } catch (e) { if (e.statusCode !== 404) throw e; }
        if (!old) await table.createEntity({ partitionKey: 'rates', rowKey, count: 1, expiresAt: new Date(now + 86400000).toISOString() });
        else {
          if (Number(old.count) >= limit) throw new Error('rate_limited');
          await table.updateEntity({ ...old, count: Number(old.count) + 1 }, 'Replace', { etag: old.etag });
        }
        return;
      } catch (e) { if (![409, 412].includes(e.statusCode)) throw new Error('rate_limited_or_unavailable'); }
    }
    throw new Error('rate_limited_or_unavailable');
  }
};
async function sendMail(message, repeatability) {
  const token = await credential.getToken('https://communication.azure.com/.default');
  const endpoint = new URL(required('ACS_ENDPOINT'));
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.communication.azure.com')) throw new Error('invalid_acs_endpoint');
  const response = await fetch(new URL('/emails:send?api-version=2023-03-31', endpoint), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1500),
    headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json', 'Repeatability-Request-ID': repeatability.requestId, 'Repeatability-First-Sent': repeatability.firstSent },
    body: JSON.stringify({ senderAddress: required('ACS_SENDER_ADDRESS'), ...message })
  });
  if (response.status !== 202) { const error = new Error('acs_rejected'); error.status = response.status; throw error; }
}
const secret=validateEmailSecret(required('EMAIL_DEDUPE_SECRET'));
const enqueue=queueTransport({endpoint:required('EMAIL_QUEUE_URL'),credential});
const otpState=otpStore(table);
const acs=acsTransport({endpoint:required('ACS_ENDPOINT'),sender:required('ACS_SENDER_ADDRESS'),credential});
app.http('emailOtp', { methods: ['POST'], authLevel: 'anonymous', route: 'entra/email-otp', handler: async (request,context) => {
  try {return await boundedCallback(async signal=>{
    const authorization=request.headers.get('authorization')??'';
    if(!authorization.startsWith('Bearer ')||authorization.length>16384)return{status:401};
    try{await verifyExtensionToken(authorization.slice(7),config,jwks);}catch{return{status:401};}
    const body=await request.text();if(body.length>16384)return{status:413};
    let event;try{event=parseEvent(JSON.parse(body),config);}catch{return{status:400};}
    const jsonBody=await acceptOtp(event,{secret,enqueue,signal});
    context.log('otp_queue_accepted'); // No token, code, address or request body.
    return{status:200,jsonBody};
  });}catch{return{status:503,jsonBody:{error:'Email acceptance temporarily unavailable'}};}
} });
app.storageQueue('emailOtpWorker',{queueName:'email-otp',connection:'EmailQueue',handler:async(message,context)=>{
  try{const result=await processOtp(message,{secret,store:otpState,send:acs.send,enqueue});context.log('otp_worker_'+result.status);}
  catch{context.error('otp_worker_unavailable');} // Never send encrypted payloads to host exception/poison logs.
}});
app.storageQueue('emailStatusWorker',{queueName:'email-status',connection:'EmailQueue',handler:async(message,context)=>{
  try{const result=await processStatus(message,{store:otpState,poll:acs.poll,enqueue});context.log('otp_status_'+result.status);}
  catch{context.error('otp_status_unavailable');}
}});
app.storageQueue('emailDeliveryWorker',{queueName:'email-delivery',connection:'EmailQueue',handler:async(message,context)=>{
  try{await processDelivery(message,{store:otpState,secret,acsResourceId:required('ACS_RESOURCE_ID')});context.log('otp_delivery_report_processed');}
  catch{context.error('otp_delivery_report_unavailable');}
}});
app.storageQueue('emailPoisonDiscard',{queueName:'email-otp-poison',connection:'EmailQueue',handler:async(_message,context)=>{context.error('otp_poison_discarded');}});
app.timer('examSweep', { schedule: SCHEDULE, runOnStartup: false, useMonitor: true, handler: async () => {
  await sweep({ enabled: process.env.EXAM_SWEEP_ENABLED === 'true', url: required('EXAM_SWEEP_URL'), secret: required('CRON_SECRET') });
} });
app.timer('emailStateCleanup', { schedule: '0 17 2 * * *', runOnStartup: false, useMonitor: true, handler: async () => {
  // Bounded work per day; only hashes/status rows are retained if cleanup lags.
  let count = 0;
  for await (const row of table.listEntities({ queryOptions: { filter: `expiresAt lt '${new Date().toISOString()}'` } })) {
    await table.deleteEntity(row.partitionKey, row.rowKey, { etag: row.etag });
    if (++count >= 10000) break;
  }
} });

app.timer('costMonitor', { schedule: '0 31 1 * * *', runOnStartup: false, useMonitor: true, handler: async () => {
  const operator=JSON.parse(required('COST_OPERATOR_JSON'));
  const now=new Date();
  let alerts;
  try { const {actual,forecast}=await collectCosts({operator,getToken:scope=>credential.getToken(scope),now}); alerts=costAlerts(actual,forecast,operator,now); }
  catch { alerts=[{key:`${now.toISOString().slice(0,10)}-cost-unavailable`,message:'Action required: Azure cost/forecast query failed. Verify billing permissions, currency, capacity and external identity cost evidence. No availability controls were changed.'}]; }
  for(const alert of alerts) {
    const key='cost-'+createHash('sha256').update(alert.key).digest('hex');
    const firstSent=now.toUTCString();
    if(!await store.claim(key,firstSent)) continue;
    const hash=createHash('sha256').update(key).digest('hex');
    try {
      await sendMail({recipients:{to:[{address:'an@vfuturelabs.org'}]},content:{subject:'VFuture Academy Azure operating-cost notice',plainText:alert.message+'\nAvailability takes priority. This is a notification only; no shutdown or automatic upgrade is configured.'}}, {requestId:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`,firstSent});
      // Retain notifications through the month, independently of one-day OTP dedupe rows.
      await table.updateEntity({partitionKey:'events',rowKey:key,status:'accepted',expiresAt:new Date(now.getTime()+40*86400000).toISOString()},'Merge');
    } catch { await table.deleteEntity('events',key); throw new Error('cost_notification_failed'); }
  }
} });

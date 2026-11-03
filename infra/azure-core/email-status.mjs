// Read only, no OTP payloads or recipients. Requires Table Data Reader and Queue Data Reader on Academy storage.
import { createRequire } from 'node:module';
import { az,policy,validateAccount } from './preflight.mjs';
const require=createRequire(new URL('./functions/package.json',import.meta.url));
const {TableClient}=await import(require.resolve('@azure/data-tables'));
const {AzureCliCredential}=await import(require.resolve('@azure/identity'));
validateAccount(az(['account','show']));
const output=az(['deployment','group','show','--name','academy-core-base','--resource-group',policy.resourceGroup,'--subscription',policy.subscriptionId]).properties.outputs;
const account=output.storageAccountName.value;
if(!/^vfast[a-z0-9]{13}$/.test(account))throw new Error('Unexpected Academy storage account');
const credential=new AzureCliCredential({tenantId:policy.tenantId});
const table=new TableClient(`https://${account}.table.core.windows.net`,'EmailState',credential);
const counts={},operations=[];let expiredPending=0;
for await(const row of table.listEntities({queryOptions:{filter:"PartitionKey eq 'otp'",select:['RowKey','status','acceptedAt','updatedAt','attempts','operationId','deliveryStatus','sendStatus','expiresAtMs']}})){
  const allowed=['accepted','processing','submitted','sent','delivered','delivery_failed','failed','expired','rate_limited'];
  const status=allowed.includes(row.status)?row.status:'unknown';counts[status]=(counts[status]??0)+1;
  if(['accepted','processing'].includes(status)&&Number(row.expiresAtMs)<Date.now())expiredPending++;
  operations.push({eventHash:row.rowKey,status,operationId:row.operationId,acceptedAt:row.acceptedAt,updatedAt:row.updatedAt,attempts:row.attempts,sendStatus:row.sendStatus,deliveryStatus:row.deliveryStatus});
}
const queueCounts={};
for(const queue of ['email-otp','email-status','email-delivery']){
  try{const token=await credential.getToken('https://storage.azure.com/.default');const response=await fetch(`https://${account}.queue.core.windows.net/${queue}?comp=metadata`,{headers:{Authorization:`Bearer ${token.token}`,'x-ms-version':'2023-11-03','x-ms-date':new Date().toUTCString()},signal:AbortSignal.timeout(10000)});queueCounts[queue]=response.ok?Number(response.headers.get('x-ms-approximate-messages-count')):'unknown';}catch{queueCounts[queue]='unknown';}
}
console.log(JSON.stringify({observedAt:new Date().toISOString(),counts,expiredPending,approximateQueueBacklogs:queueCounts,operations,semantics:{accepted:'durable queue acceptance; no delivery promise',submitted:'ACS accepted or submission ambiguous; not yet sent',sent:'ACS operation Succeeded/out for delivery',delivered:'ACS delivery report says recipient MTA accepted; not inbox/read proof'}},null,2));

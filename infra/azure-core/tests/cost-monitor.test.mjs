import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCosts, costAlerts } from '../functions/src/cost-monitor.mjs';
import { policy } from '../preflight.mjs';
test('monitor queries gross usage and forecast with Academy plus declared identity scope',async()=>{
  const requests=[];
  const operator={billingMonth:'2026-11',externalIdentityResourceIds:['/identity'],academyCostScopeReviewed:true,externalIdentityBillingReviewed:true,externalIdentityMonthToDateUsd:4,externalIdentityForecastUsd:5,outsideSubscriptionBillingEvidence:'review',freeMeterAttributionVerified:true,grantBalanceUsd:2000,grantObservedOn:'2026-11-02'};
  const result=await collectCosts({operator,now:new Date('2026-11-02'),getToken:async scope=>{assert.equal(scope,'https://management.azure.com/.default');return{token:'private'};},fetcher:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    assert.equal(options.headers.authorization,'Bearer private');
    return{ok:true,json:async()=>url.includes('/forecast?')?{properties:{columns:[{name:'Cost'},{name:'Currency'}],rows:[[32,'USD']]}}:{properties:{columns:['PreTaxCost','ResourceId','ResourceGroup','Currency'].map(name=>({name})),rows:[[28,'/academy',policy.resourceGroup,'USD'],[2,'/identity','identity-rg','USD']]}}};
  }});
  assert.equal(result.actual.grossUsageUsd,34);assert.equal(result.forecast.forecastUsd,37);
  assert.equal(requests.length,2);
  assert.deepEqual(requests[1].body.dataset.filter.or[1].dimensions.values,['/identity']);
  const alerts=costAlerts(result.actual,result.forecast,operator,new Date('2026-11-02'));
  assert.deepEqual(alerts.map(a=>a.key),['2026-11-actual-50','2026-11-actual-80','2026-11-actual-100','2026-11-forecast-100']);
});
test('a throttled forecast preserves actual spend and reports the retry delay without retrying early',async()=>{
  const operator={billingMonth:'2026-11',academyCostScopeReviewed:true,externalIdentityBillingReviewed:true,externalIdentityMonthToDateUsd:0,outsideSubscriptionBillingEvidence:'review',freeMeterAttributionVerified:true,grantBalanceUsd:2000,grantObservedOn:'2026-11-02'};
  const result=await collectCosts({operator,now:new Date('2026-11-04'),getToken:async()=>({token:'private'}),fetcher:async url=>url.includes('/forecast?')
    ? new Response(JSON.stringify({error:{message:'private provider response'}}),{status:429,headers:{'Retry-After':'60'}})
    : Response.json({properties:{columns:['PreTaxCost','ResourceId','ResourceGroup','Currency'].map(name=>({name})),rows:[[26,'/academy',policy.resourceGroup,'USD']]}})});
  assert.equal(result.actual.grossUsageUsd,26);
  assert.deepEqual(result.actual.alerts,[50,80,100]);
  assert.equal(result.forecast.available,false);
  assert.equal(result.forecast.reason,'rate_limited');
  assert.equal(result.forecast.retryAfterSeconds,60);
  const alerts=costAlerts(result.actual,result.forecast,operator,new Date('2026-11-04'));
  assert.ok(alerts.some(a=>a.key==='2026-11-actual-100'));
  assert.ok(alerts.some(a=>a.key==='2026-11-forecast-unavailable'&&a.message.includes('not a budget breach')));
  assert.ok(!alerts.some(a=>a.key.endsWith('accounting-incomplete')));
  assert.ok(!JSON.stringify({result,alerts}).includes('private provider response'));
});
test('failed actual accounting never becomes a zero-cost success',async()=>{
  await assert.rejects(()=>collectCosts({operator:{},getToken:async()=>({token:'private'}),fetcher:async()=>new Response('private response',{status:403})}),/cost_data_unavailable/);
});
test('missing/new-month billing and expiring benefits require action and never shutdown',()=>{
  const alerts=costAlerts({complete:true,alerts:[],grossUsageUsd:0},{complete:true,alert100:false},{billingMonth:'2027-09',freeMeterAttributionVerified:true,grantObservedOn:'2027-09-01',grantBalanceUsd:0,credentialExpiries:[{name:'entra-app',expiresAt:'2027-10-25'}]},new Date('2027-10-22'));
  assert.ok(alerts.some(a=>a.key.endsWith('accounting-incomplete')));assert.ok(alerts.some(a=>a.key.endsWith('expiry-grant')));assert.ok(alerts.some(a=>a.key.endsWith('expiry-freeMeters')));assert.ok(alerts.some(a=>a.key.includes('credential-entra-app')));
});

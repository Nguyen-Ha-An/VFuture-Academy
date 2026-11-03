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
  assert.deepEqual(alerts.map(a=>a.key),['2026-11-actual-50','2026-11-actual-80','2026-11-forecast-100']);
});
test('missing/new-month billing and expiring benefits require action and never shutdown',()=>{
  const alerts=costAlerts({complete:true,alerts:[],grossUsageUsd:0},{complete:true,alert100:false},{billingMonth:'2027-09',freeMeterAttributionVerified:true,grantObservedOn:'2027-09-01',grantBalanceUsd:0,credentialExpiries:[{name:'entra-app',expiresAt:'2027-10-25'}]},new Date('2027-10-22'));
  assert.ok(alerts.some(a=>a.key.endsWith('accounting-incomplete')));assert.ok(alerts.some(a=>a.key.endsWith('expiry-grant')));assert.ok(alerts.some(a=>a.key.endsWith('expiry-freeMeters')));assert.ok(alerts.some(a=>a.key.includes('credential-entra-app')));
});

import policy from './policy.json' with { type: 'json' };
import { aggregateCost, forecastReport, makeQuery } from './cost.mjs';
export function costAlerts(actual, forecast, operator, now = new Date()) {
  const month=now.toISOString().slice(0,7);
  const alerts=[];
  if (operator.billingMonth !== month || !actual.complete || !operator.freeMeterAttributionVerified) alerts.push({key:`${month}-accounting-incomplete`,message:'Action required: verify current-month outside-RG/other-subscription identity billing and free-meter attribution. Partial totals must not be treated as complete.'});
  for (const threshold of actual.alerts) alerts.push({key:`${month}-actual-${threshold}`,message:`Gross Academy + identity usage reached ${threshold}% of USD${policy.monthlySoftBudgetUsd} (observed USD${actual.grossUsageUsd.toFixed(2)}).`});
  if (forecast.available === false) alerts.push({key:`${month}-forecast-unavailable`,message:`Forecast unavailable (${forecast.reason}); this is not a budget breach. Actual observed usage remains USD${actual.grossUsageUsd.toFixed(2)}${actual.complete ? '' : ' (partial accounting)'}. Forecast requests are deferred; no immediate retry is made${forecast.retryAfterSeconds === null ? '' : ` (provider retry delay: ${forecast.retryAfterSeconds}s)`}.`});
  else if (!forecast.complete) alerts.push({key:`${month}-forecast-incomplete`,message:'Forecast accounting is incomplete; verify outside-subscription identity forecast evidence before treating it as a full-month projection.'});
  if (forecast.alert100) alerts.push({key:`${month}-forecast-100`,message:`Forecast Academy + identity cost is USD${forecast.forecastUsd.toFixed(2)}, above the USD${policy.monthlySoftBudgetUsd} soft target.`});
  for (const [name,date] of Object.entries({freeMeters:policy.benefits.meterExpiresOn,grant:policy.benefits.grantExpiresOn})) {
    const days=Math.ceil((new Date(`${date}T00:00:00Z`)-now)/86400000);
    if(days<=60) alerts.push({key:`${month}-expiry-${name}`,message:`${name} expires ${date} (${days} days remaining). Reassess paid operating cost; do not stop services.`});
  }
  if (!Number.isFinite(operator.grantBalanceUsd) || !Number.isFinite(Date.parse(operator.grantObservedOn)) || now-new Date(operator.grantObservedOn)>7*86400000) alerts.push({key:`${month}-grant-review`,message:'Refresh nonprofit credit balance evidence (last observation missing or older than seven days). Credits are spending, not a cost offset.'});
  for (const item of operator.credentialExpiries ?? []) if (!Number.isFinite(Date.parse(item.expiresAt)) || new Date(item.expiresAt)-now<60*86400000) alerts.push({key:`${month}-credential-${item.name}`,message:`Credential ${item.name} expires ${item.expiresAt}; rotate under the longest permitted credential lifetime without changing user-session expiry.`});
  return alerts;
}
export async function collectCosts({operator, getToken, fetcher=fetch, now=new Date()}) {
  const token=await getToken('https://management.azure.com/.default');
  const base=`https://management.azure.com/subscriptions/${policy.subscriptionId}/providers/Microsoft.CostManagement`;
  const query=async(path,body)=>{
    const result=await fetcher(`${base}/${path}?api-version=2023-11-01`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token.token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    if(!result.ok) {
      const retry = result.headers?.get('Retry-After') ?? result.headers?.get('x-ms-ratelimit-microsoft.costmanagement-client-retry-after') ?? result.headers?.get('x-ms-ratelimit-microsoft.consumption-retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry)-now.getTime())/1000) : NaN;
      throw Object.assign(new Error('cost_data_unavailable'), {reason:result.status===429?'rate_limited':result.status===401||result.status===403?'access_denied':'provider_unavailable',retryAfterSeconds:Number.isSafeInteger(seconds)&&seconds>=0?seconds:null});
    }
    return result.json();
  };
  const result=await query('query',makeQuery(operator));
  const scopes=(operator.externalIdentityResourceIds??[]).map(id=>({dimensions:{name:'ResourceId',operator:'In',values:[id]}}));
  const filters=[{dimensions:{name:'ResourceGroup',operator:'In',values:[policy.resourceGroup,...(operator.academyInfrastructureResourceGroups??[])]}},...scopes];
  const from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0,23,59,59)).toISOString();
  // A forecast outage must not discard a successful actual-cost query or its alerts.
  const actual=aggregateCost(result,operator);
  try {
    const projected=await query('forecast',{type:'Usage',timeframe:'Custom',timePeriod:{from,to},includeActualCost:true,dataset:{granularity:'Daily',aggregation:{cost:{name:'Cost',function:'Sum'}},filter:filters.length>1?{or:filters}:filters[0]}});
    return {actual,forecast:forecastReport(projected,operator)};
  } catch(error) {
    return {actual,forecast:{available:false,complete:false,alert100:null,reason:error.reason??'provider_unavailable',retryAfterSeconds:error.retryAfterSeconds??null}};
  }
}

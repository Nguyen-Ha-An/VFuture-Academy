import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { az, policy, validateAccount, benefitStatus } from './preflight.mjs';
export { aggregateCost, forecastReport } from './functions/src/cost.mjs';
import { aggregateCost, forecastReport, makeQuery } from './functions/src/cost.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateAccount(az(['account', 'show']));
    const operator = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const scope = `/subscriptions/${policy.subscriptionId}`;
    const result = az(['rest', '--method', 'post', '--url', `https://management.azure.com${scope}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, '--body', JSON.stringify(makeQuery(operator))]);
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 0, 23, 59, 59)).toISOString();
    const scopes = (operator.externalIdentityResourceIds ?? []).map(id => ({ dimensions: { name: 'ResourceId', operator: 'In', values: [id] } }));
    const filter = { or: [{ dimensions: { name: 'ResourceGroup', operator: 'In', values: [policy.resourceGroup, ...(operator.academyInfrastructureResourceGroups ?? [])] } }, ...scopes] };
    const forecast = az(['rest', '--method', 'post', '--url', `https://management.azure.com${scope}/providers/Microsoft.CostManagement/forecast?api-version=2023-11-01`, '--body', JSON.stringify({ type: 'Usage', timeframe: 'Custom', timePeriod: { from, to }, includeActualCost: true, dataset: { granularity: 'Daily', aggregation: { cost: { name: 'Cost', function: 'Sum' } }, filter: scopes.length ? filter : filter.or[0] } })]);
    if (operator.billingMonth !== now.toISOString().slice(0,7)) operator.externalIdentityBillingReviewed = false;
    const accounting = aggregateCost(result, operator);
    const projected = forecastReport(forecast, operator);
    console.log(JSON.stringify({ ...accounting, forecast: projected, benefits: benefitStatus(now), freeMeterAttributionVerified: operator.freeMeterAttributionVerified === true, grantBalanceUsd: operator.grantBalanceUsd, grantObservedOn: operator.grantObservedOn, expiringCredentials: (operator.credentialExpiries ?? []).filter(item => new Date(item.expiresAt) - now < 60*86400000), availabilityActions: 'none; notify an@vfuturelabs.org and investigate; no shutdown or automatic upgrade' }, null, 2));
    if (!accounting.complete || !projected.complete || !operator.freeMeterAttributionVerified) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

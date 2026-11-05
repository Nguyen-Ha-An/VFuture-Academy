import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCost, forecastReport } from '../cost-report.mjs';
import { policy, validateAccount, validateParameters, benefitStatus } from '../preflight.mjs';
const id = '11111111-1111-1111-1111-111111111111';
function parameters() { return { parameters: Object.fromEntries(Object.entries({ postgresAdminPassword: 'a'.repeat(32), postgrestDatabaseUri: 'postgresql://academy_authenticator:long-password@vfa.postgres.database.azure.com/academy?sslmode=verify-full', postgrestJwtSecret: 'b'.repeat(32), cronSecret: 'c'.repeat(32), emailDedupeSecret: 'd'.repeat(32), entraExternalTenantId: id, entraExtensionIssuer: `https://academy.ciamlogin.com/${id}/v2.0`, entraExtensionAudience: id, entraExtensionId: id, entraClientId: id, examSweepUrl: 'https://academy.example/api/v1/internal/exams/sweep', budgetStartDate: '2026-11-01T00:00:00Z' }).map(([k,v]) => [k,{ value:v }])) }; }
test('wrong account/tenant and unsafe parameters fail before cloud mutation', () => {
  validateAccount({ id: policy.subscriptionId, tenantId: policy.tenantId, state: 'Enabled' });
  assert.throws(() => validateAccount({ id: id, tenantId: policy.tenantId, state: 'Enabled' }));
  assert.equal(validateParameters(parameters()), true);
  const p = parameters(); p.parameters.examSweepEnabled = { value: true }; assert.throws(() => validateParameters(p)); assert.equal(validateParameters(p, { schedulerReceipt: true }), true);
  p.parameters.location = { value: 'eastus' }; assert.throws(() => validateParameters(p));
});
test('gross usage adds Academy, outside RG identity and outside subscription cost exactly once', () => {
  const result = { properties: { columns: ['PreTaxCost','ResourceId','ResourceGroup','Currency'].map(name => ({name})), rows: [[10,'/academy',policy.resourceGroup,'USD'],[2,'/identity','other-rg','USD'],[90,'/central','rg-central','USD']] } };
  const report = aggregateCost(result, { externalIdentityResourceIds: ['/identity','/academy'], academyCostScopeReviewed: true, externalIdentityBillingReviewed: true, externalIdentityMonthToDateUsd: 8, outsideSubscriptionBillingEvidence: 'billing-review-2026-11-02' });
  assert.equal(report.grossUsageUsd,20); assert.equal(report.complete,true); assert.deepEqual(report.alerts,[50,80]);
  assert.equal(aggregateCost(result, {}).complete,false);
  result.properties.rows[0][3] = 'VND'; assert.throws(() => aggregateCost(result, {}));
});
test('forecast and benefit expiry cannot silently assume free continued operation', () => {
  const result = { properties: { columns: [{name:'Cost'},{name:'Currency'}], rows: [[30,'USD']] } };
  assert.equal(forecastReport(result,{academyCostScopeReviewed:true,externalIdentityBillingReviewed:true,externalIdentityForecastUsd:6}).alert100,true);
  assert.equal(forecastReport(result,{}).complete,false);
  assert.equal(benefitStatus(new Date('2027-10-24')).reviewRequired,true);
  assert.ok(benefitStatus(new Date('2027-10-24')).meterDaysRemaining < 0);
});
test('email can deploy with data API explicitly held off while real identity identifiers remain required', () => {
  const p=parameters(); p.parameters.deployPostgrest={value:false};
  delete p.parameters.postgrestDatabaseUri; delete p.parameters.postgrestJwtSecret;
  assert.equal(validateParameters(p),true);
  delete p.parameters.entraExtensionId; assert.throws(()=>validateParameters(p));
});

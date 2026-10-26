/* eslint-disable @typescript-eslint/no-require-imports -- Shared dependency-free Azure Functions v3 runtime. */
'use strict';
const { createHash } = require('node:crypto');
const { amount, fresh, timestamp } = require('./policy.cjs');
function check(value, code) { if (!value) throw new Error(code); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function validateBaseline(config, baseline, state = {}, now = new Date()) {
  check(baseline?.version === 1 && baseline.id === config.baselineId && typeof baseline.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(baseline.id), 'baseline-id');
  check(baseline.operatorVerified === true && baseline.completeCreditCoverage === true && Array.isArray(baseline.coveredSubscriptionIds) && baseline.coveredSubscriptionIds.length === 1 && baseline.coveredSubscriptionIds[0] === config.subscriptionId, 'baseline-partial-credit-scope');
  check(baseline.subscriptionId === config.subscriptionId && baseline.resourceGroup === config.resourceGroup && baseline.grantStartsAt === config.grant.startsAt && baseline.grantEndsAt === config.grant.endsAt, 'baseline-scope-or-grant');
  check(Number.isFinite(timestamp(baseline.observedAt)) && timestamp(baseline.observedAt) >= timestamp(config.grant.startsAt) && timestamp(baseline.observedAt) < timestamp(config.grant.endsAt) && timestamp(baseline.observedAt) <= now.getTime(), 'baseline-time');
  check(typeof baseline.sourceReference === 'string' && baseline.sourceReference.length > 0, 'baseline-evidence');
  for (const key of ['remainingCreditUsd', 'otherCommittedUsd', 'academyGrantToDateUsd', 'subscriptionGrantCostUsd', 'academyGrantCostUsd']) check(amount(baseline[key]), 'baseline-missing-values');
  check(baseline.subscriptionGrantCostUsd >= baseline.academyGrantCostUsd, 'baseline-inconsistent-scopes');
  const baselineDigest = createHash('sha256').update(JSON.stringify(canonical(baseline))).digest('hex');
  if (state.baselineId !== undefined || state.baselineDigest !== undefined) check(state.baselineId === baseline.id && state.baselineDigest === baselineDigest, 'baseline-changed-requires-operator-rebase');
  return { baselineId: baseline.id, baselineDigest };
}
function deriveAccounting(config, baseline, usage, state = {}, now = new Date()) {
  const binding = validateBaseline(config, baseline, state, now);
  check(usage?.source === 'cost-management' && usage.currency === 'USD' && usage.subscriptionId === config.subscriptionId && usage.resourceGroup === config.resourceGroup && usage.grantStartsAt === config.grant.startsAt && usage.period === now.toISOString().slice(0, 7), 'usage-scope-or-period');
  check(fresh(usage.observedAt, now.getTime(), 15 * 60_000) && timestamp(usage.observedAt) >= timestamp(baseline.observedAt), 'usage-stale');
  for (const key of ['subscriptionGrantCostUsd', 'academyGrantCostUsd', 'academyMonthCostUsd']) check(amount(usage[key]), 'usage-missing-values');
  check(usage.subscriptionGrantCostUsd >= baseline.subscriptionGrantCostUsd && usage.academyGrantCostUsd >= baseline.academyGrantCostUsd && usage.subscriptionGrantCostUsd >= usage.academyGrantCostUsd, 'usage-below-baseline-or-inconsistent');
  const subscriptionDelta = usage.subscriptionGrantCostUsd - baseline.subscriptionGrantCostUsd;
  const academyDelta = usage.academyGrantCostUsd - baseline.academyGrantCostUsd;
  check(subscriptionDelta >= academyDelta, 'usage-inconsistent-deltas');
  if (state.usageSubscriptionGrantCostUsd !== undefined) check(usage.subscriptionGrantCostUsd >= state.usageSubscriptionGrantCostUsd && usage.academyGrantCostUsd >= state.usageAcademyGrantCostUsd && timestamp(usage.observedAt) >= timestamp(state.usageObservedAt), 'usage-counter-decreased');
  const remainingCreditUsd = Math.max(0, baseline.remainingCreditUsd - subscriptionDelta);
  const academyGrantToDateUsd = baseline.academyGrantToDateUsd + academyDelta;
  check(amount(remainingCreditUsd) && amount(academyGrantToDateUsd), 'accounting-overflow');
  const observedAt = usage.observedAt;
  return {
    snapshot: { version: 1, subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup, period: usage.period, sequence: timestamp(observedAt), observedAt, expiresAt: new Date(timestamp(observedAt) + 15 * 60_000).toISOString(), remainingCreditUsd, otherCommittedUsd: baseline.otherCommittedUsd, academyGrantToDateUsd, grantStartsAt: baseline.grantStartsAt, grantEndsAt: baseline.grantEndsAt, operatorVerified: true, sourceReference: `derived-from-verified-baseline:${baseline.id}`, accountingSource: 'automated-baseline' },
    billing: { source: 'cost-management', period: usage.period, observedAt, spendUsd: usage.academyMonthCostUsd, currency: 'USD' },
    state: { ...state, ...binding, usageSubscriptionGrantCostUsd: usage.subscriptionGrantCostUsd, usageAcademyGrantCostUsd: usage.academyGrantCostUsd, usageObservedAt: observedAt },
  };
}
module.exports = { deriveAccounting, validateBaseline };

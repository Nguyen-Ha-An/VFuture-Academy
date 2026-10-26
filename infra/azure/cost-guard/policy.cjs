/* eslint-disable @typescript-eslint/no-require-imports -- Azure Functions v3 uses a dependency-free CommonJS entrypoint. */
'use strict';
const { createHash } = require('node:crypto');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const MODES = ['normal', 'discretionary-stop', 'drain'];
function check(condition, code) { if (!condition) throw new Error(code); }
function amount(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN; }
function fresh(value, now, maximumAge) { const ms = timestamp(value); return Number.isFinite(ms) && ms <= now && now - ms <= maximumAge; }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validateConfig(config) {
  check(config && config.version === 1, 'config-version');
  check(typeof config.enabled === 'boolean', 'config-enabled');
  check(config.accountingMode === undefined || ['automated-baseline', 'manual-snapshot'].includes(config.accountingMode), 'config-accounting-mode');
  if (config.accountingMode !== 'manual-snapshot') check(typeof config.baselineId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(config.baselineId), 'config-baseline-id');
  check(config.dryRun === undefined || typeof config.dryRun === 'boolean', 'config-dry-run');
  check(config.allowOperatorCostFallback === undefined || typeof config.allowOperatorCostFallback === 'boolean', 'config-fallback');
  check(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(config.subscriptionId), 'config-subscription');
  check(/^[a-zA-Z0-9_-]{1,90}$/.test(config.resourceGroup), 'config-group');
  const prefix = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}/providers/Microsoft.Compute/virtualMachines/`;
  check(typeof config.vmResourceId === 'string' && config.vmResourceId.startsWith(prefix) && /^[a-zA-Z0-9_-]{1,64}$/.test(config.vmResourceId.slice(prefix.length)), 'config-exact-vm');
  check(config.expectedTags && config.expectedTags.project === 'vfuture-academy' && typeof config.expectedTags.environment === 'string' && config.expectedTags.environment.length > 0, 'config-tags');
  for (const value of Object.values(config.expectedTags)) check(typeof value === 'string' && value.length > 0, 'config-tag-value');
  check(config.rates && amount(config.rates.maximumHourlyUsd) && config.rates.maximumHourlyUsd > 0 && amount(config.rates.retainedDailyUsd) && config.rates.retainedDailyUsd > 0 && Number.isInteger(config.rates.retainedDays) && config.rates.retainedDays >= 30, 'config-rates');
  check(amount(config.rates.operatingMonthlyUsdNoBenefits) && config.rates.operatingMonthlyUsdNoBenefits > 0 && config.rates.operatingMonthlyUsdNoBenefits <= 90 && amount(config.rates.operatingMonthlyUsdWithBenefits) && config.rates.operatingMonthlyUsdWithBenefits > 0 && config.rates.operatingMonthlyUsdWithBenefits <= 70, 'config-operating-forecast');
  check(config.grant && Number.isFinite(timestamp(config.grant.startsAt)) && Number.isFinite(timestamp(config.grant.endsAt)) && timestamp(config.grant.endsAt) > timestamp(config.grant.startsAt) && timestamp(config.grant.endsAt) - timestamp(config.grant.startsAt) <= 366 * 24 * HOUR, 'config-grant-period');
  check(config.benefits && typeof config.benefits.confirmed === 'boolean' && Array.isArray(config.benefits.meterIds), 'config-benefits');
  if (config.benefits.confirmed) check(config.benefits.meterIds.length > 0 && config.benefits.meterIds.every(x => typeof x === 'string' && x.length > 0) && Number.isFinite(timestamp(config.benefits.expiresAt)), 'config-benefit-meters');
  check(config.storage && /^[a-z0-9]{3,24}$/.test(config.storage.account), 'config-storage');
  const containers = ['controlContainer', 'stateContainer', 'snapshotContainer', 'telemetryContainer'];
  for (const name of containers) check(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(config.storage[name]) && !config.storage[name].includes('--'), 'config-container');
  check(new Set(containers.map(x => config.storage[x])).size === 4, 'config-container-isolation');
  return config;
}
function assertScope(config, resources) {
  validateConfig(config);
  const groupId = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}`;
  check(resources?.vm?.id?.toLowerCase() === config.vmResourceId.toLowerCase() && resources?.group?.id?.toLowerCase() === groupId.toLowerCase(), 'scope-id-mismatch');
  for (const resource of [resources.vm, resources.group]) for (const [key, value] of Object.entries(config.expectedTags)) check(resource.tags?.[key] === value, 'scope-tag-mismatch');
}
function validState(state, now = Date.now()) {
  check(state && state.version === 1 && MODES.includes(state.mode), 'state-missing-or-invalid');
  for (const key of ['snapshotSequence', 'telemetrySequence', 'outboundBytes', 'spendUsd', 'academyGrantToDateUsd']) if (state[key] !== undefined) check(amount(state[key]), 'state-invalid-counter');
  const completeGroups = [
    ['snapshotSequence', 'snapshotDigest'], ['telemetrySequence', 'telemetryDigest'],
    ['period', 'outboundBytes', 'spendUsd', 'academyGrantToDateUsd'], ['baselineId', 'baselineDigest'],
    ['usageSubscriptionGrantCostUsd', 'usageAcademyGrantCostUsd', 'usageObservedAt'],
  ];
  for (const group of completeGroups) if (group.some(key => state[key] !== undefined)) check(group.every(key => state[key] !== undefined), 'state-partial-history');
  for (const key of ['snapshotSequence', 'telemetrySequence']) if (state[key] !== undefined) check(Number.isSafeInteger(state[key]) && state[key] > 0, 'state-sequence');
  for (const key of ['snapshotDigest', 'telemetryDigest', 'baselineDigest']) if (state[key] !== undefined) check(typeof state[key] === 'string' && /^[a-f0-9]{64}$/.test(state[key]), 'state-digest');
  if (state.period !== undefined) check(/^\d{4}-(0[1-9]|1[0-2])$/.test(state.period) && Number.isSafeInteger(state.outboundBytes), 'state-period');
  if (state.usageObservedAt !== undefined) check(Number.isFinite(timestamp(state.usageObservedAt)) && timestamp(state.usageObservedAt) <= now && amount(state.usageSubscriptionGrantCostUsd) && amount(state.usageAcademyGrantCostUsd), 'state-usage-history');
  if (state.deallocateRequestedAt !== undefined) check(Number.isFinite(timestamp(state.deallocateRequestedAt)) && timestamp(state.deallocateRequestedAt) <= now, 'state-deallocation-time');
  if (state.inputHold !== undefined) check(typeof state.inputHold === 'boolean', 'state-input-hold');
  if (state.financialRequestedAt !== undefined) check(Number.isFinite(timestamp(state.financialRequestedAt)) && timestamp(state.financialRequestedAt) <= now, 'state-financial-request-time');
  if (state.drainAfter !== undefined) check(Number.isFinite(timestamp(state.drainAfter)) && timestamp(state.drainAfter) > timestamp(state.financialRequestedAt) && timestamp(state.drainAfter) <= timestamp(state.financialRequestedAt) + 120_000, 'state-drain-deadline');
  if (state.financialMode !== undefined) check(MODES.includes(state.financialMode), 'state-financial-mode');
  if (state.drainReason !== undefined) check(['financial', 'scheduled-backup'].includes(state.drainReason), 'state-drain-reason');
  if (state.seenBackupRequestIds !== undefined) check(Array.isArray(state.seenBackupRequestIds) && state.seenBackupRequestIds.length <= 400 && state.seenBackupRequestIds.every(x => typeof x === 'string' && x.length <= 128), 'state-backup-history');
  if (state.drainStartedAt !== undefined) check(Number.isFinite(timestamp(state.drainStartedAt)), 'state-drain-time');
}
function protective(state, reason) {
  const mode = state?.mode === 'drain' || state?.deallocateRequestedAt ? 'drain' : 'discretionary-stop';
  const financialMode = state?.financialMode || (state?.drainReason === 'scheduled-backup' || state?.inputHold ? 'normal' : MODES.includes(state?.mode) ? state.mode : 'normal');
  // Missing evidence is a recoverable hold, not proof that a financial threshold
  // was crossed. Preserve actual financial and maintenance latches separately.
  return { valid: false, mode, reason, deallocate: false, state: { ...state, version: 1, mode, financialMode, inputHold: true } };
}
function evaluate(config, input, date = new Date()) {
  validateConfig(config);
  const now = date.getTime();
  const state = input?.state;
  try {
    check(Number.isFinite(now), 'invalid-clock'); validState(state, now);
    const { snapshot, telemetry, billing, checkpoint, backupRequest } = input;
    const period = date.toISOString().slice(0, 7);
    check(snapshot?.version === 1 && snapshot.subscriptionId === config.subscriptionId && snapshot.resourceGroup === config.resourceGroup && snapshot.period === period, 'snapshot-scope-or-period');
    check(snapshot.operatorVerified === true && typeof snapshot.sourceReference === 'string' && snapshot.sourceReference.length > 0, 'credit-not-verified');
    check(fresh(snapshot.observedAt, now, 24 * HOUR) && timestamp(snapshot.expiresAt) > now && timestamp(snapshot.expiresAt) <= timestamp(snapshot.observedAt) + 24 * HOUR, 'snapshot-stale');
    check(snapshot.grantStartsAt === config.grant.startsAt && snapshot.grantEndsAt === config.grant.endsAt && amount(snapshot.academyGrantToDateUsd), 'grant-evidence-missing-or-invalid');
    check(now >= timestamp(config.grant.startsAt), 'grant-not-started');
    check(state.academyGrantToDateUsd === undefined || snapshot.academyGrantToDateUsd >= state.academyGrantToDateUsd, 'grant-counter-decreased');
    check(amount(snapshot.remainingCreditUsd) && amount(snapshot.otherCommittedUsd) && Number.isSafeInteger(snapshot.sequence) && snapshot.sequence > 0, 'snapshot-values');
    check(telemetry?.version === 1 && telemetry.vmResourceId === config.vmResourceId && telemetry.period === period && fresh(telemetry.observedAt, now, 15 * MINUTE), 'telemetry-stale-or-scope');
    check(Number.isSafeInteger(telemetry.sequence) && telemetry.sequence > 0 && Number.isSafeInteger(telemetry.monthlyOutboundBytes) && telemetry.monthlyOutboundBytes >= 0 && Number.isSafeInteger(telemetry.activeRequests) && telemetry.activeRequests >= 0 && Number.isSafeInteger(telemetry.queuedRequests) && telemetry.queuedRequests >= 0 && amount(telemetry.pendingVariableUsd) && amount(telemetry.diskUsedRatio) && telemetry.diskUsedRatio <= 1 && Number.isSafeInteger(telemetry.activeExamAttempts) && telemetry.activeExamAttempts >= 0, 'telemetry-values');
    check(billing && ['cost-management', 'trusted-operator'].includes(billing.source) && billing.period === period && billing.currency === 'USD' && fresh(billing.observedAt, now, billing.source === 'cost-management' ? 15 * MINUTE : 24 * HOUR) && amount(billing.spendUsd), 'billing-unavailable-or-invalid');
    if (billing.source === 'trusted-operator') check(config.allowOperatorCostFallback === true && fresh(snapshot.costsCompleteThrough, now, 24 * HOUR), 'fallback-not-trusted-or-stale');
    const snapshotDigest = digest(snapshot);
    const telemetryDigest = digest(telemetry);
    check(state.snapshotSequence === undefined || snapshot.sequence > state.snapshotSequence || (snapshot.sequence === state.snapshotSequence && snapshotDigest === state.snapshotDigest), 'snapshot-replayed');
    check(state.telemetrySequence === undefined || telemetry.sequence > state.telemetrySequence || (telemetry.sequence === state.telemetrySequence && telemetryDigest === state.telemetryDigest), 'telemetry-replayed');
    if (state.period === period) check(telemetry.monthlyOutboundBytes >= state.outboundBytes && billing.spendUsd >= state.spendUsd, 'counter-decreased');
    const monthlyBudgetUsd = config.benefits.confirmed && timestamp(config.benefits.expiresAt) > now ? 70 : 90;
    // Cost Management's query time is NOT a meter completeness watermark.
    // Reserve a full 24 hours even if the API query just succeeded.
    const lagHours = Math.min(24, Math.max(0, now - timestamp(config.grant.startsAt)) / HOUR);
    const pendingUsd = config.rates.maximumHourlyUsd * lagHours + telemetry.pendingVariableUsd;
    const retainedTailUsd = config.rates.retainedDailyUsd * config.rates.retainedDays;
    const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    // Unbilled fixed charges cover the past; only future retained charges belong to
    // the monthly shutdown estimate. A full 30-day tail is reserved separately.
    const monthlyRetainedTailUsd = config.rates.retainedDailyUsd * (monthEnd - now) / (24 * HOUR);
    const shutdownGraceUsd = config.rates.maximumHourlyUsd * (120 / 3600);
    const projectedUsd = billing.spendUsd + pendingUsd + monthlyRetainedTailUsd + shutdownGraceUsd;
    const annualAllocationUsd = Math.max(0, Math.min(1080 - snapshot.academyGrantToDateUsd, snapshot.remainingCreditUsd - snapshot.otherCommittedUsd - 400));
    const grantStart = timestamp(config.grant.startsAt);
    const grantEnd = timestamp(config.grant.endsAt);
    const startDate = new Date(grantStart);
    const yearLength = Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate(), startDate.getUTCHours(), startDate.getUTCMinutes(), startDate.getUTCSeconds(), startDate.getUTCMilliseconds()) - grantStart;
    const remainingTime = Math.max(0, grantEnd - now);
    const benefitTime = config.benefits.confirmed ? Math.max(0, Math.min(grantEnd, timestamp(config.benefits.expiresAt)) - now) : 0;
    const remainingOperatingNeedUsd = (config.rates.operatingMonthlyUsdWithBenefits * 12 * benefitTime + config.rates.operatingMonthlyUsdNoBenefits * 12 * (remainingTime - benefitTime)) / yearLength;
    check([pendingUsd, retainedTailUsd, monthlyRetainedTailUsd, projectedUsd, annualAllocationUsd, remainingOperatingNeedUsd].every(amount), 'calculation-overflow');
    let mode = 'normal'; let reason = 'within-envelope';
    if (projectedUsd >= monthlyBudgetUsd * 0.8 || telemetry.monthlyOutboundBytes >= 40_000_000_000 || telemetry.diskUsedRatio >= 0.70) reason = 'warning';
    if (projectedUsd >= monthlyBudgetUsd * 0.9 || telemetry.monthlyOutboundBytes >= 45_000_000_000 || telemetry.diskUsedRatio >= 0.85) { mode = 'discretionary-stop'; reason = 'stop-discretionary'; }
    if (projectedUsd >= monthlyBudgetUsd * 0.95 || telemetry.monthlyOutboundBytes >= 50_000_000_000) { mode = 'drain'; reason = 'drain'; }
    if (annualAllocationUsd < remainingOperatingNeedUsd + pendingUsd) { mode = 'drain'; reason = 'insufficient-credit-reserve'; }
    if (retainedTailUsd + pendingUsd + shutdownGraceUsd > 400) { mode = 'drain'; reason = 'insufficient-durable-reserve'; }
    if (now >= grantEnd) { mode = 'drain'; reason = 'grant-expired'; }
    const previousFinancialMode = state.financialMode || (state.drainReason === 'scheduled-backup' ? 'normal' : state.mode);
    if (MODES.indexOf(previousFinancialMode) > MODES.indexOf(mode)) { mode = previousFinancialMode; reason = 'operator-reset-required'; }
    const financialMode = mode;
    const nextState = { ...state, version: 1, mode, financialMode, inputHold: false, period, snapshotSequence: snapshot.sequence, snapshotDigest, telemetrySequence: telemetry.sequence, telemetryDigest, outboundBytes: telemetry.monthlyOutboundBytes, spendUsd: billing.spendUsd, academyGrantToDateUsd: snapshot.academyGrantToDateUsd };
    const receiptValid = Boolean(state.drainStartedAt && checkpoint?.version === 1 && checkpoint.vmResourceId === config.vmResourceId && checkpoint.drainStartedAt === state.drainStartedAt && fresh(checkpoint.recordedAt, now, 15 * MINUTE) && timestamp(checkpoint.recordedAt) >= timestamp(state.drainStartedAt) && checkpoint.activeRequests === 0 && Number.isSafeInteger(checkpoint.activeExamAttempts) && checkpoint.activeExamAttempts >= 0 && telemetry.activeRequests === 0 && telemetry.queuedRequests === 0 && checkpoint.databaseFlushed === true && checkpoint.backupCompleted === true && typeof checkpoint.backupReference === 'string' && checkpoint.backupReference.length > 0);
    const drainTimedOut = state.drainStartedAt && now - timestamp(state.drainStartedAt) > 30 * MINUTE;
    if (state.mode === 'drain') {
      if (state.drainReason === 'scheduled-backup' && financialMode === 'normal' && !drainTimedOut && receiptValid && checkpoint.activeExamAttempts === 0 && telemetry.activeExamAttempts === 0 && checkpoint.requestId === state.backupRequestId && !state.deallocateRequestedAt) {
        mode = 'normal'; reason = 'scheduled-backup-complete';
        nextState.backupCompletedAt = date.toISOString();
        delete nextState.drainStartedAt; delete nextState.drainReason; delete nextState.backupRequestId;
      } else {
        mode = 'drain';
        nextState.drainReason = state.drainReason === 'scheduled-backup' && financialMode === 'normal' && !drainTimedOut ? 'scheduled-backup' : 'financial';
        reason = drainTimedOut ? 'checkpoint-timeout' : nextState.drainReason === 'scheduled-backup' ? 'scheduled-backup-checkpoint-required' : 'operator-reset-required';
        if (drainTimedOut && financialMode === 'normal') nextState.financialMode = 'discretionary-stop';
      }
    }
    if (backupRequest) {
      check(backupRequest.version === 1 && backupRequest.vmResourceId === config.vmResourceId && typeof backupRequest.requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(backupRequest.requestId), 'backup-request-scope-or-id');
      check(Number.isFinite(timestamp(backupRequest.requestedAt)) && timestamp(backupRequest.requestedAt) <= now && timestamp(backupRequest.expiresAt) > timestamp(backupRequest.requestedAt) && timestamp(backupRequest.expiresAt) <= timestamp(backupRequest.requestedAt) + 30 * MINUTE, 'backup-request-time');
      const day = date.toISOString().slice(0, 10);
      const seen = state.seenBackupRequestIds || [];
      const requestFresh = fresh(backupRequest.requestedAt, now, 30 * MINUTE) && timestamp(backupRequest.expiresAt) > now && backupRequest.requestedAt.slice(0, 10) === day;
      if (requestFresh && mode === 'normal' && financialMode === 'normal' && telemetry.activeExamAttempts === 0 && state.backupAcceptedDay !== day && !seen.includes(backupRequest.requestId)) {
        mode = 'drain'; reason = 'scheduled-backup';
        nextState.drainReason = 'scheduled-backup'; nextState.backupRequestId = backupRequest.requestId;
        nextState.drainStartedAt = date.toISOString(); nextState.backupAcceptedDay = day;
        nextState.seenBackupRequestIds = [...seen, backupRequest.requestId].slice(-400);
      }
    }
    if (financialMode === 'drain' && !state.deallocateRequestedAt) {
      if (!nextState.financialRequestedAt) {
        nextState.financialRequestedAt = date.toISOString();
        // Already published full drain never reopens a grace window.
        if (state.mode !== 'drain' && telemetry.activeExamAttempts > 0) {
          nextState.drainAfter = new Date(now + 120_000).toISOString();
          nextState.drainStartedAt = nextState.drainAfter;
        }
      }
      nextState.drainReason = 'financial';
      if (nextState.drainAfter && now < timestamp(nextState.drainAfter) && state.mode !== 'drain' && telemetry.activeExamAttempts > 0) {
        mode = 'discretionary-stop'; reason = 'financial-drain-grace';
      }
    }
    if (state.deallocateRequestedAt) { mode = 'drain'; reason = 'deallocation-request-recorded'; nextState.drainReason = 'financial'; }
    if (mode === 'drain' && !nextState.drainStartedAt) nextState.drainStartedAt = date.toISOString();
    if (mode === 'drain' && !nextState.drainReason) nextState.drainReason = 'financial';
    nextState.mode = mode;
    let deallocate = false;
    // A receipt must follow a drain from a PREVIOUS invocation. A scheduled backup
    // can never cause VM deallocation; a later financial threshold is a new cause.
    if (mode === 'drain' && nextState.drainReason === 'financial' && financialMode === 'drain' && state.drainStartedAt && !state.deallocateRequestedAt) {
      if (drainTimedOut) reason = 'checkpoint-timeout';
      else if (receiptValid) deallocate = true;
      else reason = 'checkpoint-required';
    }
    return { valid: true, mode, reason, deallocate, monthlyBudgetUsd, projectedUsd, pendingUsd, retainedTailUsd, monthlyRetainedTailUsd, shutdownGraceUsd, annualAllocationUsd, remainingOperatingNeedUsd, state: nextState };
  } catch (error) { return protective(state, error.message); }
}
module.exports = { evaluate, validateConfig, assertScope, validState, protective, amount, fresh, timestamp };

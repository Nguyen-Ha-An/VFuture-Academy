import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { evaluate, validateConfig, assertScope } = require('../../infra/azure/cost-guard/policy.cjs');
const { runGuard } = require('../../infra/azure/cost-guard/runner.cjs');
const { deriveAccounting, validateBaseline } = require('../../infra/azure/cost-guard/accounting.cjs');
const { createAzureClient } = require('../../infra/azure/cost-guard/azure-client.cjs');

const now = new Date('2026-10-25T10:00:00.000Z');
const vmId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/academy/providers/Microsoft.Compute/virtualMachines/academy-db';
const config = {
  version: 1, enabled: true, dryRun: false, accountingMode: 'manual-snapshot',
  subscriptionId: '11111111-1111-4111-8111-111111111111', resourceGroup: 'academy', vmResourceId: vmId,
  expectedTags: { project: 'vfuture-academy', environment: 'production' },
  rates: { maximumHourlyUsd: 0.1, retainedDailyUsd: 0.2, retainedDays: 30, operatingMonthlyUsdNoBenefits: 85, operatingMonthlyUsdWithBenefits: 65 },
  grant: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' }, benefits: { confirmed: false, meterIds: [], expiresAt: null },
  storage: { account: 'academyguard', controlContainer: 'control', stateContainer: 'state', snapshotContainer: 'billing', telemetryContainer: 'telemetry' },
};
function inputs(spend = 10) {
  return {
    snapshot: { version: 1, subscriptionId: config.subscriptionId, resourceGroup: 'academy', period: '2026-10', sequence: 1, observedAt: now.toISOString(), expiresAt: '2026-10-26T10:00:00.000Z', remainingCreditUsd: 1800, otherCommittedUsd: 100, academyGrantToDateUsd: spend, grantStartsAt: config.grant.startsAt, grantEndsAt: config.grant.endsAt, operatorVerified: true, sourceReference: 'portal-export-20261025', monthlySpendUsd: spend, costsCompleteThrough: '2026-10-24T10:00:00.000Z' },
    billing: { source: 'cost-management', period: '2026-10', observedAt: now.toISOString(), spendUsd: spend, currency: 'USD' },
    telemetry: { version: 1, vmResourceId: vmId, period: '2026-10', observedAt: now.toISOString(), sequence: 1, monthlyOutboundBytes: 1024, pendingVariableUsd: 0.6, diskUsedRatio: 0.3, activeRequests: 0, queuedRequests: 0, activeExamAttempts: 0 },
    state: { version: 1, mode: 'normal' }, checkpoint: null, backupRequest: null, backupAlert: null,
  };
}
function fakeClient(data = inputs(83)) {
  const events: string[] = [];
  let locked = false;
  let state: Record<string, unknown> = data.state;
  let control: Record<string, unknown> | undefined;
  return {
    events, get control() { return control; }, get state() { return state; },
    readScope: async () => ({ vm: { id: vmId, tags: config.expectedTags }, group: { id: `/subscriptions/${config.subscriptionId}/resourceGroups/academy`, tags: config.expectedTags } }),
    acquireLease: async () => { if (locked) return null; locked = true; return 'lease'; },
    renewLease: async () => { if (!locked) throw Error('lease lost'); },
    releaseLease: async () => { locked = false; },
    readState: async () => state,
    readSnapshot: async () => data.snapshot,
    readTelemetry: async () => data.telemetry,
    readCheckpoint: async () => data.checkpoint,
    readBackupRequest: async () => data.backupRequest,
    readBackupAlert: async () => data.backupAlert,
    readCosts: async () => data.billing,
    writeControl: async (value: Record<string, unknown>) => { control = value; events.push('control'); },
    writeState: async (value: Record<string, unknown>) => { state = structuredClone(value); events.push('state'); },
    deallocate: async () => { events.push('deallocate'); },
  };
}

describe('Azure cost guard policy', () => {
  it.each([[68, 'normal', 'warning'], [77, 'discretionary-stop', 'stop-discretionary'], [82, 'drain', 'drain']] as const)('includes pending usage and only the uncounted current-month retention tail at spend %s', (spend, mode, reason) => {
    const decision = evaluate(config, inputs(spend), now);
    expect(decision.mode).toBe(mode);
    expect(decision.reason).toBe(reason);
    expect(decision.projectedUsd).toBeCloseTo(spend + 4.32);
  });
  it('uses $70 envelope only with current operator-confirmed meter benefits', () => {
    const c = { ...config, benefits: { confirmed: true, meterIds: ['actual-meter-id'], expiresAt: '2027-10-23T00:00:00.000Z' } };
    expect(evaluate(c, inputs(60), now).mode).toBe('discretionary-stop');
    expect(evaluate({ ...c, benefits: { ...c.benefits, expiresAt: '2026-10-24T00:00:00.000Z' } }, inputs(60), now).mode).toBe('normal');
  });
  it('warns at 70 percent disk and stops discretionary work at 85 percent without deleting data', () => {
    const data = inputs();
    data.telemetry.diskUsedRatio = 0.7;
    expect(evaluate(config, data, now)).toMatchObject({ mode: 'normal', reason: 'warning' });
    data.telemetry.diskUsedRatio = 0.85;
    expect(evaluate(config, data, now)).toMatchObject({ mode: 'discretionary-stop', deallocate: false });
    data.telemetry.diskUsedRatio = 1.1;
    expect(evaluate(config, data, now)).toMatchObject({ valid: false, deallocate: false });
  });
  it('protects the credit reserve and caps allocation at $1080', () => {
    const data = inputs(0);
    expect(evaluate(config, data, now).annualAllocationUsd).toBe(1080);
    data.snapshot.remainingCreditUsd = 550;
    const decision = evaluate(config, data, now);
    expect(decision.annualAllocationUsd).toBe(50);
    expect(decision.mode).toBe('drain');
    expect(decision.reason).toBe('insufficient-credit-reserve');
  });
  it('reduces grant-year headroom by actual Academy spending and covers only the remaining grant period', () => {
    const midyear = new Date('2026-07-02T12:00:00.000Z');
    const data = inputs(1);
    data.snapshot.period = '2026-07'; data.snapshot.observedAt = midyear.toISOString(); data.snapshot.expiresAt = '2026-07-03T12:00:00.000Z';
    data.snapshot.academyGrantToDateUsd = 450; data.snapshot.remainingCreditUsd = 1150;
    data.telemetry.period = data.snapshot.period; data.telemetry.observedAt = midyear.toISOString();
    data.billing.period = data.snapshot.period; data.billing.observedAt = midyear.toISOString();
    const decision = evaluate(config, data, midyear);
    expect(decision.valid).toBe(true); expect(decision.mode).toBe('normal');
    expect(decision.annualAllocationUsd).toBe(630);
    expect(decision.remainingOperatingNeedUsd).toBe(510);
  });
  it('does not halt a normal 72.54-dollar month by adding another full month of retained charges', () => {
    const monthEnd = new Date('2026-10-31T23:00:00.000Z');
    const data = inputs(72.54);
    data.snapshot.observedAt = monthEnd.toISOString(); data.snapshot.expiresAt = '2026-11-01T23:00:00.000Z'; data.snapshot.academyGrantToDateUsd = 725.4; data.snapshot.remainingCreditUsd = 1174.6;
    data.telemetry.observedAt = monthEnd.toISOString(); data.billing.observedAt = monthEnd.toISOString();
    const decision = evaluate({ ...config, rates: { ...config.rates, maximumHourlyUsd: 0.15, retainedDailyUsd: 1, retainedDays: 30 } }, data, monthEnd);
    expect(decision.mode).toBe('normal'); expect(decision.projectedUsd).toBeCloseTo(76.7866666667);
    expect(decision.monthlyRetainedTailUsd).toBeCloseTo(0.0416666667);
    expect(decision.retainedTailUsd).toBe(30);
  });
  it('keeps the durable reserve separate and drains when the retained tail exceeds it', () => {
    const decision = evaluate({ ...config, rates: { ...config.rates, retainedDailyUsd: 15 } }, inputs(), now);
    expect(decision.mode).toBe('drain'); expect(decision.reason).toBe('insufficient-durable-reserve');
  });
  it('does not reset Academy grant-to-date spending at month rollover or accept missing grant evidence', () => {
    const data = inputs(80); const first = evaluate(config, data, now);
    data.state = first.state; data.snapshot.sequence = 2; data.snapshot.academyGrantToDateUsd = 79;
    expect(evaluate(config, data, now).valid).toBe(false);
    for (const missing of ['academyGrantToDateUsd', 'grantStartsAt', 'grantEndsAt']) {
      const fresh = inputs(); delete (fresh.snapshot as Record<string, unknown>)[missing];
      expect(evaluate(config, fresh, now)).toMatchObject({ valid: false, deallocate: false });
    }
  });
  it('adds unbilled past charges to future operating obligations at the grant expiry edge', () => {
    const edge = new Date('2026-12-31T00:00:00.000Z'); const data = inputs(10);
    data.snapshot.period = '2026-12'; data.snapshot.observedAt = edge.toISOString(); data.snapshot.expiresAt = '2027-01-01T00:00:00.000Z';
    data.snapshot.academyGrantToDateUsd = 1075; data.snapshot.remainingCreditUsd = 900; data.snapshot.otherCommittedUsd = 0;
    data.billing.period = data.snapshot.period; data.billing.observedAt = edge.toISOString(); data.telemetry.period = data.snapshot.period; data.telemetry.observedAt = edge.toISOString();
    const decision = evaluate({ ...config, rates: { ...config.rates, maximumHourlyUsd: 0.15, retainedDailyUsd: 1.5, retainedDays: 30 } }, data, edge);
    expect(decision.annualAllocationUsd).toBe(5); expect(decision.pendingUsd).toBeCloseTo(4.2);
    expect(decision.mode).toBe('drain'); expect(decision.reason).toBe('insufficient-credit-reserve');
  });
  it('does not invent a full day of lag before the verified grant begins', () => {
    const start = new Date(config.grant.startsAt); const data = inputs(0);
    data.snapshot.period = '2026-01'; data.snapshot.observedAt = start.toISOString(); data.snapshot.expiresAt = '2026-01-02T00:00:00.000Z';
    data.snapshot.remainingCreditUsd = 2000; data.snapshot.otherCommittedUsd = 0;
    data.billing.period = data.snapshot.period; data.billing.observedAt = start.toISOString(); data.telemetry.period = data.snapshot.period; data.telemetry.observedAt = start.toISOString(); data.telemetry.pendingVariableUsd = 0;
    const decision = evaluate(config, data, start);
    expect(decision.pendingUsd).toBe(0); expect(decision.remainingOperatingNeedUsd).toBe(1020); expect(decision.mode).toBe('normal');
  });
  it('admits the actual example rates five minutes into the grant without a false financial latch', () => {
    const example = require('../../infra/azure/cost-guard/config.example.json');
    const start = new Date('2026-01-01T00:05:00.000Z'); const data = inputs(0);
    data.snapshot.period = '2026-01'; data.snapshot.observedAt = start.toISOString(); data.snapshot.expiresAt = '2026-01-02T00:05:00.000Z'; data.snapshot.remainingCreditUsd = 2000; data.snapshot.otherCommittedUsd = 0;
    data.billing.period = data.snapshot.period; data.billing.observedAt = start.toISOString(); data.telemetry.period = data.snapshot.period; data.telemetry.observedAt = start.toISOString(); data.telemetry.pendingVariableUsd = 0;
    const decision = evaluate({ ...config, rates: example.rates }, data, start);
    expect(decision.pendingUsd).toBeCloseTo(0.0125); expect(decision.mode).toBe('normal'); expect(decision.state.financialMode).toBe('normal');
    expect(decision.remainingOperatingNeedUsd).toBeCloseTo(1019.9902968);
    data.state = decision.state;
    expect(evaluate({ ...config, rates: example.rates }, data, new Date('2026-01-01T00:10:00.000Z')).mode).toBe('normal');
  });
  it.each([undefined, NaN, Infinity, 0, -1, 91])('rejects missing or invalid no-benefit operating forecast %s', value => {
    expect(() => validateConfig({ ...config, rates: { ...config.rates, operatingMonthlyUsdNoBenefits: value } })).toThrow();
  });
  it('never accepts a benefit operating forecast above the approved $70 envelope', () => {
    expect(() => validateConfig({ ...config, rates: { ...config.rates, operatingMonthlyUsdWithBenefits: 70.01 } })).toThrow();
  });
  it.each([NaN, Infinity, -1])('rejects malformed or negative cost %s', value => {
    const data = inputs(); data.billing.spendUsd = value;
    expect(evaluate(config, data, now)).toMatchObject({ mode: 'discretionary-stop', valid: false, deallocate: false });
  });
  it('requires positive retained charge and pending-rate ceilings', () => {
    expect(() => validateConfig({ ...config, rates: { ...config.rates, retainedDailyUsd: 0 } })).toThrow();
    expect(() => validateConfig({ ...config, rates: { ...config.rates, maximumHourlyUsd: -1 } })).toThrow();
  });
  it.each(['snapshot', 'telemetry', 'billing'])('rejects missing %s without zero-usage fallback', key => {
    const data = inputs(); (data as Record<string, unknown>)[key] = null;
    expect(evaluate(config, data, now)).toMatchObject({ valid: false, mode: 'discretionary-stop', deallocate: false });
  });
  it('rejects stale telemetry and period mismatch', () => {
    const data = inputs(); data.telemetry.observedAt = '2026-10-25T09:00:00.000Z';
    expect(evaluate(config, data, now).valid).toBe(false);
    data.telemetry.observedAt = now.toISOString(); data.telemetry.period = '2026-09';
    expect(evaluate(config, data, now).valid).toBe(false);
  });
  it('rejects stale credit, replay and decreasing persisted counters', () => {
    const data = inputs(); data.snapshot.expiresAt = '2026-10-24T00:00:00.000Z';
    expect(evaluate(config, data, now).valid).toBe(false);
    const good = inputs();
    const first = evaluate(config, good, now);
    good.state = first.state;
    good.snapshot.sequence = 0;
    expect(evaluate(config, good, now).valid).toBe(false);
    good.snapshot.sequence = 1; good.telemetry.monthlyOutboundBytes = 1;
    expect(evaluate(config, good, now).valid).toBe(false);
  });
  it('allows fresh next-month counters but does not automatically clear protection', () => {
    const data = inputs(83); const first = evaluate(config, data, now);
    const next = inputs(0); next.state = first.state; next.snapshot.academyGrantToDateUsd = 83;
    next.snapshot.sequence = 2; next.snapshot.period = '2026-11'; next.snapshot.observedAt = '2026-11-01T00:00:00.000Z'; next.snapshot.expiresAt = '2026-11-02T00:00:00.000Z';
    next.billing.period = '2026-11'; next.billing.observedAt = next.snapshot.observedAt;
    next.telemetry.period = '2026-11'; next.telemetry.observedAt = next.snapshot.observedAt; next.telemetry.monthlyOutboundBytes = 0; next.telemetry.sequence = 2;
    const decision = evaluate(config, next, new Date(next.snapshot.observedAt));
    expect(decision.valid).toBe(true); expect(decision.mode).toBe('drain'); expect(decision.deallocate).toBe(false);
  });
  it('rejects cross-subscription/VM paths, wildcards, and wrong project or environment tags', () => {
    expect(() => validateConfig({ ...config, vmResourceId: vmId.replace('academy-db', '*') })).toThrow();
    expect(() => validateConfig({ ...config, subscriptionId: '22222222-2222-4222-8222-222222222222' })).toThrow();
    expect(() => assertScope(config, { vm: { id: vmId, tags: { ...config.expectedTags, project: 'another' } }, group: { id: `/subscriptions/${config.subscriptionId}/resourceGroups/academy`, tags: config.expectedTags } })).toThrow();
  });
});

describe('Azure cost guard state machine', () => {
  it('defaults to dry-run and performs no mutation', async () => {
    const client = fakeClient(); const { dryRun: _ignored, ...c } = config;
    expect((await runGuard(c, client, now)).status).toBe('dry-run'); expect(client.events).toEqual([]);
  });
  it('disabled guard never reads Azure or changes control', async () => {
    const client = fakeClient(); client.readScope = async () => { throw Error('must not read'); };
    expect((await runGuard({ ...config, enabled: false }, client, now)).status).toBe('disabled'); expect(client.events).toEqual([]);
  });
  it('publishes drain before deallocation and requires an actual matching flush/backup receipt', async () => {
    const data = inputs(83); const client = fakeClient(data);
    await runGuard(config, client, now);
    expect(client.control?.mode).toBe('drain'); expect(client.events).not.toContain('deallocate');
    (data as Record<string, unknown>).checkpoint = { version: 1, vmResourceId: vmId, drainStartedAt: now.toISOString(), recordedAt: '2026-10-25T10:01:00.000Z', activeRequests: 0, activeExamAttempts: 0, databaseFlushed: true, backupCompleted: true, backupReference: 'backup-20261025' };
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.events).toEqual(['state', 'control', 'state', 'control', 'state', 'deallocate']);
    await runGuard(config, client, new Date('2026-10-25T10:06:00.000Z'));
    expect(client.events.filter(x => x === 'deallocate')).toHaveLength(1);
  });
  it('drain timeout never force-stops or deletes durable data', async () => {
    const data = inputs(83); data.state = { version: 1, mode: 'drain', drainStartedAt: '2026-10-25T09:00:00.000Z' } as typeof data.state;
    const client = fakeClient(data); const result = await runGuard(config, client, now);
    expect(result.reason).toBe('checkpoint-timeout'); expect(client.events).not.toContain('deallocate'); expect(client.control?.mode).toBe('drain');
  });
  it('missing or unsupported billing publishes protective maintenance and blocks deallocation', async () => {
    const client = fakeClient(); client.readCosts = async () => { throw Error('unsupported Sponsorship'); };
    const result = await runGuard(config, client, now);
    expect(result.valid).toBe(false); expect(client.control?.mode).toBe('discretionary-stop'); expect(client.events).not.toContain('deallocate');
  });
  it('only an explicitly enabled fresh verified operator cost fallback can replace unavailable Cost Management', async () => {
    const client = fakeClient(inputs(10)); client.readCosts = async () => { throw Error('unsupported'); };
    expect((await runGuard({ ...config, allowOperatorCostFallback: true }, client, now)).valid).toBe(true);
  });
  it('requires an empty queue and rejects checkpoint replay or an incomplete backup', async () => {
    for (const invalid of [{ queuedRequests: 1 }, { backupCompleted: false }, { drainStartedAt: '2026-10-25T09:00:00.000Z' }]) {
      const data = inputs(83);
      data.state = { version: 1, mode: 'drain', drainStartedAt: '2026-10-25T09:55:00.000Z' } as typeof data.state;
      (data as Record<string, unknown>).checkpoint = { version: 1, vmResourceId: vmId, drainStartedAt: '2026-10-25T09:55:00.000Z', recordedAt: '2026-10-25T09:56:00.000Z', activeRequests: 0, activeExamAttempts: 0, databaseFlushed: true, backupCompleted: true, backupReference: 'backup', ...invalid };
      if ('queuedRequests' in invalid) data.telemetry.queuedRequests = 1;
      const client = fakeClient(data);
      await runGuard(config, client, now);
      expect(client.events).not.toContain('deallocate');
    }
  });
  it('refuses all mutations after loss of its state lease', async () => {
    const client = fakeClient(); client.renewLease = async () => { throw Error('lease lost'); };
    expect((await runGuard(config, client, now)).status).toBe('guard-failed');
    expect(client.events).toEqual([]);
  });
  it('never blindly retries an unknown deallocation outcome', async () => {
    const data = inputs(83);
    data.state = { version: 1, mode: 'drain', drainStartedAt: '2026-10-25T09:55:00.000Z' } as typeof data.state;
    (data as Record<string, unknown>).checkpoint = { version: 1, vmResourceId: vmId, drainStartedAt: '2026-10-25T09:55:00.000Z', recordedAt: '2026-10-25T09:56:00.000Z', activeRequests: 0, activeExamAttempts: 0, databaseFlushed: true, backupCompleted: true, backupReference: 'backup' };
    const client = fakeClient(data);
    client.deallocate = async () => { client.events.push('deallocate'); throw Error('network outcome unknown'); };
    expect((await runGuard(config, client, now)).status).toBe('guard-failed');
    await runGuard(config, client, now);
    expect(client.events.filter(x => x === 'deallocate')).toHaveLength(1);
    expect(client.state.deallocateRequestedAt).toBe(now.toISOString());
  });
  it('recovers a temporary uncertain-input hold only after fresh monotonic valid accounting', async () => {
    const data = inputs(10); const client = fakeClient(data);
    client.readCosts = async () => { throw Error('transient API outage'); };
    await runGuard(config, client, now);
    expect(client.control?.mode).toBe('discretionary-stop'); expect(client.state.inputHold).toBe(true);
    client.readCosts = async () => data.billing;
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.control?.mode).toBe('normal'); expect(client.state.financialMode).toBe('normal'); expect(client.events).not.toContain('deallocate');
  });
  it('scope mismatch causes no mutation', async () => {
    const client = fakeClient(); client.readScope = async () => ({ vm: { id: vmId + '-other', tags: config.expectedTags }, group: { id: `/subscriptions/${config.subscriptionId}/resourceGroups/academy`, tags: config.expectedTags } });
    expect((await runGuard(config, client, now)).status).toBe('scope-blocked'); expect(client.events).toEqual([]);
  });
  it('control write failure blocks deallocation', async () => {
    const client = fakeClient(); client.writeControl = async () => { throw Error('blob write failure'); };
    expect((await runGuard(config, client, now)).status).toBe('guard-failed'); expect(client.events).not.toContain('deallocate');
  });
  it('persists a financial latch before publishing control so a partial write cannot auto-resume', async () => {
    const client = fakeClient(); client.writeControl = async () => { throw Error('unknown blob write outcome'); };
    expect((await runGuard(config, client, now)).status).toBe('guard-failed');
    expect(client.state.mode).toBe('drain'); expect(client.state.financialMode).toBe('drain');
    expect(client.events).not.toContain('deallocate');
  });
  it.each([null, {}, { version: 2, mode: 'normal' }, { version: 1, mode: 'normal', snapshotSequence: 5 }, { version: 1, mode: 'normal', period: 'invalid' }, { version: 1, mode: 'discretionary-stop', financialMode: 'drain', financialRequestedAt: '2099-01-01T00:00:00.000Z', drainAfter: '2099-01-01T00:02:00.000Z' }])('never reconstructs an invalid durable ledger from %j', async invalid => {
    const client = fakeClient(inputs());
    Object.assign(client, { readState: async () => invalid });
    expect((await runGuard(config, client, now)).status).toBe('guard-failed');
    expect(client.events).toEqual([]);
    expect((await runGuard(config, client, now)).status).toBe('guard-failed');
    expect(client.events).toEqual([]);
  });
  it('concurrent invocations cannot issue competing mutations', async () => {
    const client = fakeClient();
    const result = await Promise.all([runGuard(config, client, now), runGuard(config, client, now)]);
    expect(result.some(x => x.status === 'lease-busy')).toBe(true); expect(client.events.filter(x => x === 'control')).toHaveLength(1);
  });
});

describe('bounded financial exam grace', () => {
  it('persists a fixed 120-second deadline across restart and drains even a stuck active attempt', async () => {
    const data = inputs(83); data.telemetry.activeExamAttempts = 1;
    const first = fakeClient(data); await runGuard(config, first, now);
    expect(first.control).toMatchObject({ mode: 'discretionary-stop', drainReason: 'financial', financialRequestedAt: now.toISOString(), drainAfter: '2026-10-25T10:02:00.000Z' });
    data.state = first.state as typeof data.state;
    const restarted = fakeClient(data); await runGuard(config, restarted, new Date('2026-10-25T10:01:00.000Z'));
    expect(restarted.control?.drainAfter).toBe('2026-10-25T10:02:00.000Z');
    await runGuard(config, restarted, new Date('2026-10-25T10:02:00.000Z'));
    expect(restarted.control?.mode).toBe('drain');
    (data as Record<string, unknown>).checkpoint = { version: 1, vmResourceId: vmId, drainStartedAt: '2026-10-25T10:02:00.000Z', recordedAt: '2026-10-25T10:02:01.000Z', activeRequests: 0, activeExamAttempts: 1, databaseFlushed: true, backupCompleted: true, backupReference: 'preserved-in-progress-attempt' };
    await runGuard(config, restarted, new Date('2026-10-25T10:05:00.000Z'));
    expect(restarted.events).toContain('deallocate');
  });
  it('preserves the deadline during an uncertain-input hold and never fabricates a checkpoint', async () => {
    const data = inputs(83); data.telemetry.activeExamAttempts = 1;
    const client = fakeClient(data); await runGuard(config, client, now);
    client.readCosts = async () => { throw Error('transient'); };
    await runGuard(config, client, new Date('2026-10-25T10:03:00.000Z'));
    expect(client.control?.drainAfter).toBe('2026-10-25T10:02:00.000Z'); expect(client.events).not.toContain('deallocate');
    expect(client.state.financialMode).toBe('drain');
  });
});

describe('daily backup pause isolation', () => {
  function backupInput() {
    const data = inputs();
    (data as Record<string, unknown>).backupRequest = { version: 1, vmResourceId: vmId, requestId: 'daily-20261025', requestedAt: now.toISOString(), expiresAt: '2026-10-25T10:30:00.000Z' };
    return data;
  }
  function complete(data: ReturnType<typeof inputs>, overrides: Record<string, unknown> = {}) {
    (data as Record<string, unknown>).checkpoint = { version: 1, vmResourceId: vmId, requestId: 'daily-20261025', drainStartedAt: now.toISOString(), recordedAt: '2026-10-25T10:01:00.000Z', activeRequests: 0, activeExamAttempts: 0, databaseFlushed: true, backupCompleted: true, backupReference: 'daily-backup', ...overrides };
  }
  it('resumes only its own completed scheduled pause without deallocating the VM', async () => {
    const data = backupInput(); const client = fakeClient(data);
    await runGuard(config, client, now);
    expect(client.control).toMatchObject({ mode: 'drain', drainReason: 'scheduled-backup', backupRequestId: 'daily-20261025' });
    complete(data);
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.control?.mode).toBe('normal'); expect(client.events).not.toContain('deallocate');
    await runGuard(config, client, new Date('2026-10-25T10:06:00.000Z'));
    expect(client.control?.mode).toBe('normal');
  });
  it('will not start a scheduled pause while an exam is active', async () => {
    const data = backupInput(); data.telemetry.activeExamAttempts = 1;
    const client = fakeClient(data); await runGuard(config, client, now);
    expect(client.control?.mode).toBe('normal'); expect(client.events).not.toContain('deallocate');
  });
  it('a financial threshold during backup cannot resume normal or deallocate at the 90-percent threshold', async () => {
    const data = backupInput(); const client = fakeClient(data); await runGuard(config, client, now);
    complete(data); data.billing.spendUsd = 77;
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.control).toMatchObject({ mode: 'drain', drainReason: 'financial' });
    expect(client.events).not.toContain('deallocate');
    // Even if a later input appears recovered, the financial latch remains.
    await runGuard(config, client, new Date('2026-10-25T10:06:00.000Z'));
    expect(client.control?.mode).toBe('drain');
  });
  it('never clears an earlier financial latch for a backup request', async () => {
    const data = backupInput(); data.state = { version: 1, mode: 'discretionary-stop' };
    const client = fakeClient(data); complete(data); await runGuard(config, client, now);
    expect(client.control?.mode).toBe('discretionary-stop'); expect(client.events).not.toContain('deallocate');
  });
  it.each([{ requestId: 'other-cycle' }, { activeExamAttempts: 1 }, { databaseFlushed: false }])('requires a receipt from this safe backup cycle: %j', async overrides => {
    const data = backupInput(); const client = fakeClient(data); await runGuard(config, client, now); complete(data, overrides);
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.control?.mode).toBe('drain'); expect(client.events).not.toContain('deallocate');
  });
  it('stale financial inputs hold the backup drain, then fresh monotonic normal accounting permits its matched receipt', async () => {
    const data = backupInput(); const client = fakeClient(data); await runGuard(config, client, now); complete(data);
    data.snapshot.expiresAt = '2026-10-25T10:02:00.000Z';
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(client.control?.mode).toBe('drain');
    data.snapshot.sequence = 2; data.snapshot.expiresAt = '2026-10-26T10:00:00.000Z';
    await runGuard(config, client, new Date('2026-10-25T10:06:00.000Z'));
    expect(client.control?.mode).toBe('normal'); expect(client.events).not.toContain('deallocate');
  });
  it('surfaces host backup failure without logging its arbitrary payload or clearing protection', async () => {
    const data = backupInput(); const client = fakeClient(data); await runGuard(config, client, now);
    (data as Record<string, unknown>).backupAlert = { version: 1, vmResourceId: vmId, status: 'attention-required', recordedAt: now.toISOString(), reason: 'untrusted-private-payload' };
    const result = await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    expect(result.operatorAttention).toBe('backup-attention-required');
    expect(JSON.stringify(result)).not.toContain('untrusted-private-payload');
    expect(client.control?.mode).toBe('drain'); expect(client.events).not.toContain('deallocate');
  });
  it('ignores old requests and accepts at most one request per UTC day', async () => {
    const data = backupInput(); const client = fakeClient(data);
    (data.backupRequest as unknown as Record<string, unknown>).requestedAt = '2026-10-24T10:00:00.000Z';
    (data.backupRequest as unknown as Record<string, unknown>).expiresAt = '2026-10-24T10:30:00.000Z';
    await runGuard(config, client, now); expect(client.control?.mode).toBe('normal');
    (data as Record<string, unknown>).backupRequest = { version: 1, vmResourceId: vmId, requestId: 'daily-20261025', requestedAt: now.toISOString(), expiresAt: '2026-10-25T10:30:00.000Z' };
    await runGuard(config, client, now); complete(data);
    await runGuard(config, client, new Date('2026-10-25T10:05:00.000Z'));
    (data.backupRequest as unknown as Record<string, unknown>).requestId = 'second-same-day';
    await runGuard(config, client, new Date('2026-10-25T10:06:00.000Z'));
    expect(client.control?.mode).toBe('normal'); expect(client.events).not.toContain('deallocate');
  });
});

describe('unattended baseline accounting', () => {
  const automatic = { ...config, accountingMode: 'automated-baseline', baselineId: 'verified-grant-2026' };
  function baseline() { return { version: 1, id: 'verified-grant-2026', operatorVerified: true, completeCreditCoverage: true, coveredSubscriptionIds: [config.subscriptionId], subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup, grantStartsAt: config.grant.startsAt, grantEndsAt: config.grant.endsAt, observedAt: '2026-01-01T00:00:00.000Z', remainingCreditUsd: 2000, otherCommittedUsd: 100, academyGrantToDateUsd: 0, subscriptionGrantCostUsd: 0, academyGrantCostUsd: 0, sourceReference: 'verified-portal-and-usage-export' }; }
  function usage() { return { source: 'cost-management', currency: 'USD', subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup, grantStartsAt: config.grant.startsAt, observedAt: now.toISOString(), period: '2026-10', subscriptionGrantCostUsd: 600, academyGrantCostUsd: 500, academyMonthCostUsd: 20 }; }
  it('derives current balance and grant spending from a verified immutable baseline without daily manual refresh', () => {
    const result = deriveAccounting(automatic, baseline(), usage(), { version: 1, mode: 'normal' }, now);
    expect(result.snapshot.remainingCreditUsd).toBe(1400); expect(result.snapshot.academyGrantToDateUsd).toBe(500); expect(result.billing.spendUsd).toBe(20);
    expect(result.snapshot.period).toBe('2026-10'); expect(result.state.baselineId).toBe('verified-grant-2026');
  });
  it('rejects changed or replayed baselines and partial credit scope', () => {
    const first = deriveAccounting(automatic, baseline(), usage(), { version: 1, mode: 'normal' }, now);
    expect(() => deriveAccounting(automatic, { ...baseline(), remainingCreditUsd: 2100 }, usage(), first.state, now)).toThrow();
    expect(() => validateBaseline(automatic, { ...baseline(), completeCreditCoverage: false }, {}, now)).toThrow();
    expect(() => validateBaseline(automatic, { ...baseline(), coveredSubscriptionIds: [config.subscriptionId, '22222222-2222-4222-8222-222222222222'] }, {}, now)).toThrow();
    expect(() => validateBaseline(automatic, { ...baseline(), subscriptionGrantCostUsd: undefined }, {}, now)).toThrow();
  });
  it('rejects stale, decreasing, missing and inconsistent usage without zero-cost invention', () => {
    const first = deriveAccounting(automatic, baseline(), usage(), {}, now);
    for (const bad of [{ ...usage(), subscriptionGrantCostUsd: 599 }, { ...usage(), observedAt: '2026-10-24T00:00:00.000Z' }, { ...usage(), academyGrantCostUsd: 700 }, { ...usage(), academyMonthCostUsd: undefined }]) {
      expect(() => deriveAccounting(automatic, baseline(), bad, first.state, now)).toThrow();
    }
  });
  it('derives a new month automatically while retaining cumulative grant totals', () => {
    const first = deriveAccounting(automatic, baseline(), usage(), {}, now);
    const november = new Date('2026-11-01T12:00:00.000Z');
    const next = deriveAccounting(automatic, baseline(), { ...usage(), period: '2026-11', observedAt: november.toISOString(), subscriptionGrantCostUsd: 620, academyGrantCostUsd: 515, academyMonthCostUsd: 1 }, first.state, november);
    expect(next.snapshot.period).toBe('2026-11'); expect(next.snapshot.academyGrantToDateUsd).toBe(515); expect(next.snapshot.remainingCreditUsd).toBe(1380);
  });
  it('runs with automatic accounting by default and never reads the manual snapshot when Azure usage succeeds', async () => {
    const client = fakeClient(inputs());
    client.readSnapshot = async () => { throw Error('manual snapshot should not be read'); };
    Object.assign(client, { readBaseline: async () => baseline(), readAccountingUsage: async () => usage() });
    const { accountingMode: _mode, ...defaultMode } = automatic;
    const result = await runGuard(defaultMode, client, now);
    expect(result.valid).toBe(true); expect(client.control?.mode).toBe('normal'); expect(client.state.baselineId).toBe('verified-grant-2026');
  });
});

describe('Azure HTTP boundaries', () => {
  it('queries only exact RG and rejects empty/non-USD/negative cost data', async () => {
    const requests: { url: string; options: RequestInit }[] = [];
    let rows: unknown[][] = [[10, 'USD']];
    const fakeFetch = async (url: string, options: RequestInit) => { requests.push({ url, options }); return new Response(JSON.stringify({ properties: { columns: [{ name: 'PreTaxCost' }, { name: 'Currency' }], rows } })); };
    const client = createAzureClient(config, { fetch: fakeFetch, token: async () => 'fake-test-token' });
    expect((await client.readCosts(now)).spendUsd).toBe(10);
    expect(requests[0].url).toBe(`https://management.azure.com/subscriptions/${config.subscriptionId}/resourceGroups/academy/providers/Microsoft.CostManagement/query?api-version=2025-03-01`);
    expect(JSON.parse(requests[0].options.body as string).type).toBe('ActualCost');
    for (const invalid of [[], [[10, 'VND']], [[-1, 'USD']]]) { rows = invalid; await expect(client.readCosts(now)).rejects.toThrow(); }
  });
  it('queries complete grant usage for only the exact subscription plus Academy RG totals', async () => {
    const urls: string[] = [];
    const automatic = { ...config, accountingMode: 'automated-baseline', baselineId: 'verified-grant' };
    const baseline = { version: 1, id: 'verified-grant', operatorVerified: true, completeCreditCoverage: true, coveredSubscriptionIds: [config.subscriptionId], subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup, grantStartsAt: config.grant.startsAt, grantEndsAt: config.grant.endsAt, observedAt: config.grant.startsAt, remainingCreditUsd: 2000, otherCommittedUsd: 0, academyGrantToDateUsd: 0, subscriptionGrantCostUsd: 0, academyGrantCostUsd: 0, sourceReference: 'verified-export' };
    const client = createAzureClient(automatic, { fetch: async (url: string) => { urls.push(url); return new Response(JSON.stringify({ properties: { columns: [{ name: 'PreTaxCost' }, { name: 'Currency' }], rows: [[20, 'USD']] } })); }, token: async () => 'fake' });
    const data = await client.readAccountingUsage(baseline, now);
    expect(data.subscriptionGrantCostUsd).toBe(20); expect(data.academyGrantCostUsd).toBe(20); expect(data.academyMonthCostUsd).toBe(20);
    expect(urls.filter(url => url.includes('/resourceGroups/academy/'))).toHaveLength(2);
    expect(urls.filter(url => url === `https://management.azure.com/subscriptions/${config.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`)).toHaveLength(1);
  });
  it('only deallocates the exact configured VM and never uses force shutdown or deletion', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const client = createAzureClient(config, { fetch: async (url: string, options: RequestInit) => { calls.push({ url, method: options.method }); return new Response(null, { status: 202 }); }, token: async () => 'fake' });
    await client.deallocate();
    expect(calls).toEqual([{ url: `https://management.azure.com${vmId}/deallocate?api-version=2025-04-01`, method: 'POST' }]);
  });
});

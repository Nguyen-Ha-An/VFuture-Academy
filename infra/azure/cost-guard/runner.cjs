/* eslint-disable @typescript-eslint/no-require-imports -- Azure Functions v3 uses a dependency-free CommonJS entrypoint. */
'use strict';
const { deriveAccounting, validateBaseline } = require('./accounting.cjs');
const { evaluate, validateConfig, assertScope, validState, protective, timestamp } = require('./policy.cjs');
async function runGuard(config, client, now = new Date()) {
  try { validateConfig(config); } catch { return { status: 'config-blocked', reason: 'invalid-configuration', valid: false }; }
  if (!config.enabled) return { status: 'disabled' };
  try { assertScope(config, await client.readScope()); } catch { return { status: 'scope-blocked', reason: 'exact-scope-or-tags-unverified', valid: false }; }
  let lease; let state;
  try {
    if (config.dryRun === false) {
      lease = await client.acquireLease();
      if (!lease) return { status: 'lease-busy' };
    }
    // Missing or corrupt state is never reconstructed as a fresh normal ledger.
    state = await client.readState(lease);
    // Ledger corruption is not a transient input outage. Never overwrite or
    // reconstruct replay/deallocation history; an operator must reconcile it.
    validState(state, now.getTime());
    let decision;
    try {
      const [telemetry, checkpoint, backupRequest, backupAlert] = await Promise.all([client.readTelemetry(), client.readCheckpoint(), client.readBackupRequest(), client.readBackupAlert()]);
      let snapshot; let billing; let accountingState = state;
      if (config.accountingMode !== 'manual-snapshot') {
        // Baseline validation is outside the optional API fallback: a changed or
        // partially covered baseline must never silently fall through to manual data.
        const baseline = await client.readBaseline();
        accountingState = { ...state, ...validateBaseline(config, baseline, state, now) };
        let usage;
        try { usage = await client.readAccountingUsage(baseline, now); }
        catch { if (config.allowOperatorCostFallback !== true) throw new Error('complete-credit-usage-api-unavailable'); }
        if (usage) ({ snapshot, billing, state: accountingState } = deriveAccounting(config, baseline, usage, state, now));
      }
      if (!snapshot) {
        snapshot = await client.readSnapshot();
        try { billing = await client.readCosts(now); }
        catch {
          if (config.allowOperatorCostFallback === true) billing = { source: 'trusted-operator', period: snapshot?.period, observedAt: snapshot?.observedAt, spendUsd: snapshot?.monthlySpendUsd, currency: 'USD' };
          else throw new Error('billing-unavailable-check-sponsorship-access-or-upload-trusted-snapshot');
        }
      }
      decision = evaluate(config, { snapshot, telemetry, checkpoint, backupRequest, billing, state: accountingState }, now);
      if (backupAlert) {
        if (backupAlert.version !== 1 || backupAlert.vmResourceId !== config.vmResourceId || !['completed', 'attention-required'].includes(backupAlert.status) || !Number.isFinite(timestamp(backupAlert.recordedAt)) || timestamp(backupAlert.recordedAt) > now.getTime()) throw new Error('backup-alert-invalid');
        if (backupAlert.status === 'attention-required') decision.operatorAttention = 'backup-attention-required';
      }
    } catch { decision = protective(state, 'input-unavailable-check-billing-credit-telemetry'); }
    if (config.dryRun !== false) return { ...decision, status: 'dry-run' };
    const control = { version: 1, mode: decision.mode, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), ...(decision.state.drainStartedAt ? { drainStartedAt: decision.state.drainStartedAt, drainReason: decision.state.drainReason } : {}), ...(decision.state.backupRequestId ? { backupRequestId: decision.state.backupRequestId } : {}), ...(decision.state.financialRequestedAt ? { financialRequestedAt: decision.state.financialRequestedAt } : {}), ...(decision.state.drainAfter ? { drainAfter: decision.state.drainAfter } : {}) };
    await client.renewLease(lease);
    // Persist protective latches first: an uncertain control write must not let a
    // later run forget a financial stop and publish normal automatically.
    await client.writeState(decision.state, lease);
    await client.writeControl(control);
    if (decision.valid && decision.deallocate) {
      // Recheck exact IDs/tags immediately before the only compute mutation.
      assertScope(config, await client.readScope());
      await client.renewLease(lease);
      decision.state.deallocateRequestedAt = now.toISOString();
      // Persist intent BEFORE the request. An unknown outcome requires operator reconciliation,
      // never a blind retry after a timeout or process crash.
      await client.writeState(decision.state, lease);
      await client.deallocate();
      return { ...decision, status: 'deallocation-requested' };
    }
    return { ...decision, status: 'control-published' };
  } catch {
    // No powerOff/delete/restart fallback. The last control expires closed at the gateway.
    return { status: 'guard-failed', reason: 'storage-lease-or-azure-failure-check-operator-alert', valid: false, deallocate: false };
  } finally {
    if (lease) { try { await client.releaseLease(lease); } catch { /* Lease expires after 60 seconds. */ } }
  }
}
module.exports = { runGuard };

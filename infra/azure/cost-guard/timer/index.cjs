/* eslint-disable @typescript-eslint/no-require-imports -- Azure Functions v3 uses a dependency-free CommonJS entrypoint. */
'use strict';
const { runGuard } = require('../runner.cjs');
const { createAzureClient } = require('../azure-client.cjs');
module.exports = async function costTimer(context) {
  let result;
  try {
    const config = JSON.parse(process.env.COST_GUARD_CONFIG_JSON || 'null');
    result = await runGuard(config, createAzureClient(config));
  } catch {
    // Never log raw configuration, HTTP bodies, tokens, or student content.
    context.log.error('cost-guard: invalid configuration or identity initialization');
    throw new Error('cost-guard-configuration-failed');
  }
  const summary = JSON.stringify({ status: result.status, mode: result.mode, reason: result.reason, valid: result.valid, operatorAttention: result.operatorAttention });
  if (['config-blocked', 'scope-blocked', 'guard-failed'].includes(result.status) || result.valid === false || result.operatorAttention) {
    context.log.error(summary);
    throw new Error('cost-guard-operator-action-required');
  }
  if (result.reason === 'warning' || result.mode === 'drain' || result.mode === 'discretionary-stop') context.log.warn(summary);
  else context.log(summary);
};

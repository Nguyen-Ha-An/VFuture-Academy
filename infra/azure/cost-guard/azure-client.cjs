/* eslint-disable @typescript-eslint/no-require-imports -- Azure Functions v3 uses a dependency-free CommonJS entrypoint. */
'use strict';
const { validateBaseline } = require('./accounting.cjs');
const { validateConfig, amount } = require('./policy.cjs');
const ARM = 'https://management.azure.com';
const STORAGE = 'https://storage.azure.com/';
function createAzureClient(config, dependencies = {}) {
  validateConfig(config);
  const fetcher = dependencies.fetch || globalThis.fetch;
  const environment = dependencies.env || process.env;
  const groupId = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}`;
  const blobBase = `https://${config.storage.account}.blob.core.windows.net`;
  const blobPath = (container, name) => `${blobBase}/${container}/${name}`;
  const stateUrl = blobPath(config.storage.stateContainer, 'state.json');
  const token = dependencies.token || (async resource => {
    if (!environment.IDENTITY_ENDPOINT || !environment.IDENTITY_HEADER) throw new Error('managed-identity-unavailable');
    const endpoint = new URL(environment.IDENTITY_ENDPOINT);
    endpoint.searchParams.set('resource', resource);
    endpoint.searchParams.set('api-version', '2019-08-01');
    const response = await fetcher(endpoint.href, { headers: { 'X-IDENTITY-HEADER': environment.IDENTITY_HEADER }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('managed-identity-failed');
    const body = await response.json();
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('managed-identity-token-invalid');
    return body.access_token;
  });
  async function request(url, options = {}, allowedStatuses = []) {
    const resource = url.startsWith(`${blobBase}/`) ? STORAGE : `${ARM}/`;
    if (!(url.startsWith(`${blobBase}/`) || url.startsWith(`${ARM}${groupId}/`) || url === `${ARM}${groupId}?api-version=2021-04-01` || url === `${ARM}/subscriptions/${config.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`)) throw new Error('endpoint-outside-scope');
    const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${await token(resource)}`, 'content-type': 'application/json', ...(resource === STORAGE ? { 'x-ms-version': '2023-11-03', 'x-ms-date': new Date().toUTCString() } : {}), ...options.headers } });
    if (!response.ok && !allowedStatuses.includes(response.status)) throw new Error(`azure-status-${response.status}`);
    return response;
  }
  async function readBlob(container, name, optional = false) {
    const response = await request(blobPath(container, name), {}, optional ? [404] : []);
    if (response.status === 404 && optional) return null;
    const body = await response.text();
    if (body.length > 64 * 1024) throw new Error('blob-too-large');
    return JSON.parse(body);
  }
  async function writeBlob(url, value, lease) {
    await request(url, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', ...(lease ? { 'x-ms-lease-id': lease } : {}) }, body: JSON.stringify(value) });
  }
  async function queryCost(scope, timeframe, timePeriod) {
    const response = await request(`${ARM}${scope}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`, { method: 'POST', body: JSON.stringify({ type: 'ActualCost', timeframe, ...(timePeriod ? { timePeriod } : {}), dataset: { granularity: 'None', aggregation: { totalCost: { name: 'PreTaxCost', function: 'Sum' } } } }) });
    const data = (await response.json()).properties;
    if (!data || data.nextLink || !Array.isArray(data.columns) || !Array.isArray(data.rows) || data.rows.length === 0) throw new Error('cost-incomplete');
    const cost = data.columns.findIndex(x => x.name === 'PreTaxCost' || x.name === 'Cost');
    const currency = data.columns.findIndex(x => x.name === 'Currency');
    if (cost < 0 || currency < 0) throw new Error('cost-columns');
    let spendUsd = 0;
    for (const row of data.rows) { if (!Array.isArray(row) || !amount(row[cost]) || row[currency] !== 'USD') throw new Error('cost-value'); spendUsd += row[cost]; }
    if (!amount(spendUsd)) throw new Error('cost-overflow');
    return spendUsd;
  }
  return {
    async readScope() {
      const [vm, group] = await Promise.all([request(`${ARM}${config.vmResourceId}?api-version=2025-04-01`), request(`${ARM}${groupId}?api-version=2021-04-01`)]);
      return { vm: await vm.json(), group: await group.json() };
    },
    async acquireLease() {
      // Bootstrap state is operator-created; 404 cannot silently reset anti-replay counters.
      const response = await request(`${stateUrl}?comp=lease`, { method: 'PUT', headers: { 'x-ms-lease-action': 'acquire', 'x-ms-lease-duration': '60', 'content-length': '0' } }, [409]);
      if (response.status === 409) return null;
      const id = response.headers.get('x-ms-lease-id');
      if (!id) throw new Error('lease-missing');
      return id;
    },
    async renewLease(lease) { await request(`${stateUrl}?comp=lease`, { method: 'PUT', headers: { 'x-ms-lease-action': 'renew', 'x-ms-lease-id': lease, 'content-length': '0' } }); },
    async releaseLease(lease) { await request(`${stateUrl}?comp=lease`, { method: 'PUT', headers: { 'x-ms-lease-action': 'release', 'x-ms-lease-id': lease, 'content-length': '0' } }); },
    readState: () => readBlob(config.storage.stateContainer, 'state.json'),
    readSnapshot: () => readBlob(config.storage.snapshotContainer, 'snapshot.json'),
    readBaseline: () => readBlob(config.storage.snapshotContainer, 'baseline.json'),
    readTelemetry: () => readBlob(config.storage.telemetryContainer, 'telemetry.json'),
    readCheckpoint: () => readBlob(config.storage.telemetryContainer, 'checkpoint.json', true),
    readBackupRequest: () => readBlob(config.storage.telemetryContainer, 'backup-request.json', true),
    readBackupAlert: () => readBlob(config.storage.telemetryContainer, 'backup-alert.json', true),
    writeControl: value => writeBlob(blobPath(config.storage.controlContainer, 'maintenance.json'), value),
    writeState: (value, lease) => writeBlob(stateUrl, value, lease),
    async readCosts(now = new Date()) {
      const spendUsd = await queryCost(groupId, 'MonthToDate');
      return { source: 'cost-management', period: now.toISOString().slice(0, 7), observedAt: now.toISOString(), spendUsd, currency: 'USD' };
    },
    async readAccountingUsage(baseline, now = new Date()) {
      validateBaseline(config, baseline, {}, now);
      const grantRange = { from: config.grant.startsAt, to: now.toISOString() };
      const monthRange = { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: now.toISOString() };
      const [subscriptionGrantCostUsd, academyGrantCostUsd, academyMonthCostUsd] = await Promise.all([
        queryCost(`/subscriptions/${config.subscriptionId}`, 'Custom', grantRange),
        queryCost(groupId, 'Custom', grantRange),
        queryCost(groupId, 'Custom', monthRange),
      ]);
      return { source: 'cost-management', currency: 'USD', subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup, grantStartsAt: config.grant.startsAt, observedAt: now.toISOString(), period: now.toISOString().slice(0, 7), subscriptionGrantCostUsd, academyGrantCostUsd, academyMonthCostUsd };
    },
    async deallocate() { await request(`${ARM}${config.vmResourceId}/deallocate?api-version=2025-04-01`, { method: 'POST' }); },
  };
}
module.exports = { createAzureClient };

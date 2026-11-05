import policy from './policy.json' with { type: 'json' };
export function aggregateCost(result, operator) {
  if (result.properties.nextLink) throw new Error('Paginated cost response must be fully collected before reporting');
  const columns = result.properties.columns.map(c => c.name);
  const idx = name => { const i = columns.indexOf(name); if (i < 0) throw new Error(`Cost response missing ${name}`); return i; };
  const cost = idx('PreTaxCost'), resource = idx('ResourceId'), group = idx('ResourceGroup'), currency = idx('Currency');
  const identityIds = new Set((operator.externalIdentityResourceIds ?? []).map(id => id.toLowerCase()));
  let academy = 0, infrastructure = 0, identity = 0;
  const infrastructureGroups = new Set((operator.academyInfrastructureResourceGroups ?? []).map(name => name.toLowerCase()));
  for (const row of result.properties.rows) {
    const id = String(row[resource]).toLowerCase();
    const inGroup = String(row[group]).toLowerCase() === policy.resourceGroup;
    const inInfrastructure = !inGroup && infrastructureGroups.has(String(row[group]).toLowerCase());
    if (!inGroup && !inInfrastructure && !identityIds.has(id)) continue;
    if (row[currency] !== 'USD' || !Number.isFinite(Number(row[cost])) || Number(row[cost]) < 0) throw new Error('Non-USD or net credit adjustment requires gross-cost review');
    if (inGroup) academy += Number(row[cost]); else if (inInfrastructure) infrastructure += Number(row[cost]); else identity += Number(row[cost]);
  }
  const external = operator.externalIdentityMonthToDateUsd;
  const complete = operator.academyCostScopeReviewed === true && operator.externalIdentityBillingReviewed === true && Number.isFinite(external) && external >= 0 && Boolean(operator.outsideSubscriptionBillingEvidence);
  const total = academy + infrastructure + identity + (complete ? external : 0);
  return { academyResourceGroupUsd: academy, academyManagedInfrastructureUsd: infrastructure, outsideGroupIdentityUsd: identity, outsideSubscriptionIdentityUsd: complete ? external : null, grossUsageUsd: total, complete, percentOfSoftBudget: total / policy.monthlySoftBudgetUsd * 100, alerts: [50,80,100].filter(t => total / policy.monthlySoftBudgetUsd * 100 >= t), creditBalanceIsNotCostOffset: true };
}
export function makeQuery(operator = {}) {
  const filters = [{ dimensions: { name: 'ResourceGroup', operator: 'In', values: [policy.resourceGroup, ...(operator.academyInfrastructureResourceGroups ?? [])] } }, ...(operator.externalIdentityResourceIds ?? []).map(id => ({ dimensions: { name: 'ResourceId', operator: 'In', values: [id] } }))];
  return { type: 'Usage', timeframe: 'MonthToDate', dataset: { filter: filters.length > 1 ? { or: filters } : filters[0], granularity: 'None', aggregation: { cost: { name: 'PreTaxCost', function: 'Sum' } }, grouping: [{ type: 'Dimension', name: 'ResourceId' }, { type: 'Dimension', name: 'ResourceGroup' }] } };
}
export function forecastReport(result, operator) {
  if (result.properties.nextLink) throw new Error('Paginated forecast must be fully collected before reporting');
  const columns = result.properties.columns.map(c => c.name);
  const cost = columns.includes('PreTaxCost') ? columns.indexOf('PreTaxCost') : columns.indexOf('Cost'), currency = columns.indexOf('Currency');
  if (cost < 0 || currency < 0) throw new Error('Unexpected forecast response');
  let total = 0;
  for (const row of result.properties.rows) { if (row[currency] !== 'USD' || !Number.isFinite(Number(row[cost])) || Number(row[cost]) < 0) throw new Error('Forecast must be finite nonnegative USD'); total += Number(row[cost]); }
  const external = operator.externalIdentityForecastUsd;
  const complete = operator.academyCostScopeReviewed === true && operator.externalIdentityBillingReviewed === true && Number.isFinite(external) && external >= 0;
  return { forecastUsd: complete ? total + external : total, complete, alert100: complete ? total + external >= policy.monthlySoftBudgetUsd : null };
}

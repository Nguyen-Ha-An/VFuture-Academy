import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fields = new Set(['subscriptionId', 'resourceGroup', 'operatorCidr', 'sshPublicKey', 'imageVersion', 'grantRemainingUsd', 'committedOtherProjectsUsd', 'months', 'benefitsConfirmed', 'budgetStartDate', 'notificationEmail', 'registrySku', 'registryBenefitConfirmed', 'registryBenefitMeterId', 'acsResourceId', 'acsEmailDomainResourceId', 'acsSmtpUsernameResourceId']);

export function validateProvisioning(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('operator input must be an object');
  for (const key of Object.keys(input)) if (!fields.has(key)) throw new Error(`unexpected operator input: ${key}`);
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.subscriptionId ?? '')) throw new Error('subscriptionId must be a UUID');
  if (input.resourceGroup !== 'rg-vfuture-academy-sg') throw new Error('resource group must be rg-vfuture-academy-sg');
  if (typeof input.benefitsConfirmed !== 'boolean') throw new Error('benefits must be explicitly confirmed or unconfirmed');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 12) throw new Error('months must be 1..12');
  for (const name of ['grantRemainingUsd', 'committedOtherProjectsUsd']) {
    if (!Number.isFinite(input[name]) || input[name] < 0) throw new Error(`invalid grant evidence: ${name}`);
  }
  const monthlyBudgetUsd = input.benefitsConfirmed ? 70 : 90;
  const annualAllocationUsd = Math.min(1080, input.grantRemainingUsd - input.committedOtherProjectsUsd - 400);
  if (annualAllocationUsd < monthlyBudgetUsd * input.months) throw new Error('Academy allocation cannot fund the requested period after other commitments and $400 reserve');
  const cidr = input.operatorCidr;
  if (cidr !== '') {
    const match = typeof cidr === 'string' && cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/32$/);
    const octets = match && match.slice(1).map(Number);
    if (!octets || octets.some(n => n > 255) || [0, 10, 127].includes(octets[0]) || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) throw new Error('operator CIDR must be empty or one explicit public IPv4 /32');
  }
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/.test(input.sshPublicKey ?? '')) throw new Error('sshPublicKey must be an Ed25519 public key');
  if (!/^\d+\.\d+\.\d+$/.test(input.imageVersion ?? '')) throw new Error('imageVersion must be an exact marketplace image version, never latest');
  if (!/^\d{4}-\d{2}-01$/.test(input.budgetStartDate ?? '') || Number.isNaN(Date.parse(input.budgetStartDate))) throw new Error('budgetStartDate must be the first day of a month');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.notificationEmail ?? '')) throw new Error('notificationEmail is required');
  const registrySku = input.registrySku ?? 'Basic';
  if (!['Basic', 'Standard'].includes(registrySku)) throw new Error('registry SKU must be Basic or verified-benefit Standard');
  if (registrySku === 'Standard' && (input.registryBenefitConfirmed !== true || input.benefitsConfirmed !== true || typeof input.registryBenefitMeterId !== 'string' || !input.registryBenefitMeterId.trim())) throw new Error('Standard registry requires explicitly verified free-benefit meter');
  const rgPrefix = `/subscriptions/${input.subscriptionId}/resourceGroups/${input.resourceGroup}/providers/Microsoft.Communication/`;
  if (input.acsResourceId !== `${rgPrefix}communicationServices/academy-sg-acs` || input.acsSmtpUsernameResourceId !== `${rgPrefix}communicationServices/academy-sg-acs/smtpUsernames/academy-runtime`) throw new Error('ACS resources must match the exact Academy subscription, group and names');
  const domainPrefix = `${rgPrefix}emailServices/academy-sg-email/domains/`;
  if (typeof input.acsEmailDomainResourceId !== 'string' || !input.acsEmailDomainResourceId.startsWith(domainPrefix)) throw new Error('ACS email domain must be in the exact Academy email service');
  const emailDomainName = input.acsEmailDomainResourceId.slice(domainPrefix.length);
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(emailDomainName)) throw new Error('An actual custom ACS email domain is required');
  const parameters = Object.fromEntries(['operatorCidr', 'sshPublicKey', 'imageVersion', 'budgetStartDate', 'notificationEmail'].map(key => [key, { value: input[key] }]));
  parameters.registrySku = { value: registrySku };
  parameters.emailDomainName = { value: emailDomainName };
  parameters.monthlyBudgetUsd = { value: monthlyBudgetUsd };
  return { annualAllocationUsd, monthlyBudgetUsd, parameters };
}

export function validateRuntime(compose) {
  const errors = [];
  let residentMiB = 0;
  for (const [name, service] of Object.entries(compose.services ?? {})) {
    if (!/@sha256:[a-f\d]{64}$/.test(service.image ?? '')) errors.push(`${name}: image must include a sha256 digest`);
    const memory = String(service.mem_limit ?? '').match(/^(\d+)(m|g)$/i);
    if (!memory) errors.push(`${name}: a hard memory cap is required`);
    else if (!service.profiles?.length) residentMiB += Number(memory[1]) * (memory[2].toLowerCase() === 'g' ? 1024 : 1);
    if (['studio', 'meta'].includes(name)) {
      if (!service.profiles?.includes('operator')) errors.push(`${name}: operator profile is required`);
      if ((service.ports ?? []).some(port => !String(port).startsWith('127.0.0.1:'))) errors.push(`${name}: only loopback operator access is allowed`);
    } else if (name === 'tls') {
      if (JSON.stringify(service.ports) !== JSON.stringify(['443:8443'])) errors.push('tls: only HTTPS 443 may be published');
    } else if (service.ports?.length) errors.push(`${name}: host ports are forbidden`);
    if (service.privileged || service.network_mode === 'host') errors.push(`${name}: privileged or host networking is forbidden`);
  }
  if (residentMiB > 2624) errors.push('resident memory exceeds 2624 MiB');
  if (Number(compose.services?.auth?.environment?.GOTRUE_DB_MAX_POOL_SIZE) > 4) errors.push('Auth pool exceeds 4');
  if (Number(compose.services?.rest?.environment?.PGRST_DB_POOL) > 8) errors.push('PostgREST pool exceeds 8');
  if (Number(compose.services?.storage?.environment?.DATABASE_MAX_CONNECTIONS) > 4) errors.push('Storage pool exceeds 4');
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const errors = validateRuntime(JSON.parse(await readFile(new URL('./runtime/compose.json', import.meta.url), 'utf8')));
    if (errors.length) throw new Error(errors.join('\n'));
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const result = validateProvisioning(input);
    process.stdout.write(JSON.stringify({ $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#', contentVersion: '1.0.0.0', parameters: result.parameters }, null, 2) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

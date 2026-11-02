import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const policy = JSON.parse(readFileSync(new URL('./functions/src/policy.json', import.meta.url), 'utf8'));
export function az(args) {
  try { return JSON.parse(execFileSync('az', [...args, '--only-show-errors', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })); }
  catch { throw new Error(`Azure read failed (${args.slice(0, 2).join(' ')}); inspect authentication/permissions locally without sharing secrets.`); }
}
export function validateAccount(account) {
  if (account.id !== policy.subscriptionId || account.tenantId !== policy.tenantId || account.state !== 'Enabled') throw new Error('Wrong subscription, tenant, or disabled account');
}
export function benefitStatus(now = new Date()) {
  const remaining = date => Math.ceil((new Date(`${date}T00:00:00Z`) - now) / 86400000);
  return { meterDaysRemaining: remaining(policy.benefits.meterExpiresOn), grantDaysRemaining: remaining(policy.benefits.grantExpiresOn), reviewRequired: remaining(policy.benefits.meterExpiresOn) <= 60 || remaining(policy.benefits.grantExpiresOn) <= 60 };
}
export function validateParameters(document, { schedulerReceipt = false, base = false } = {}) {
  const p = Object.fromEntries(Object.entries(document.parameters ?? {}).map(([key, value]) => [key, value.value]));
  if (p.location && p.location !== policy.location) throw new Error('Region must be Southeast Asia');
  if (p.prefix && !/^vfa-[a-z0-9-]{1,14}$/.test(p.prefix)) throw new Error('Academy prefix required');
  if (p.deployPostgrest !== undefined && typeof p.deployPostgrest !== 'boolean') throw new Error('Data API deployment flag must be boolean');
  const deployDataApi = base ? p.deployPostgrest === true : p.deployPostgrest !== false;
  for (const name of (!deployDataApi ? ['postgresAdminPassword','cronSecret','emailDedupeSecret'] : ['postgresAdminPassword', 'postgrestDatabaseUri', 'postgrestJwtSecret', 'cronSecret', 'emailDedupeSecret'])) {
    if (!document.parameters?.[name]?.reference && (typeof p[name] !== 'string' || p[name].length < 32)) throw new Error(`Missing secure parameter: ${name}`);
  }
  if (p.postgrestDatabaseUri) {
    const u = new URL(p.postgrestDatabaseUri);
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname.endsWith('.postgres.database.azure.com') || u.username !== 'academy_authenticator' || u.searchParams.get('sslmode') !== 'verify-full' || u.pathname !== '/academy') throw new Error('PostgREST requires academy_authenticator, academy DB, Azure hostname and sslmode=verify-full');
  }
  if (base) { if (!/^\d{4}-\d{2}-01T00:00:00Z$/.test(p.budgetStartDate ?? '')) throw new Error('Budget start must be first of month'); return true; }
  for (const name of ['entraExternalTenantId', 'entraExtensionAudience', 'entraExtensionId', 'entraClientId']) if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(p[name] ?? '')) throw new Error(`Invalid identifier: ${name}`);
  const issuer = new URL(p.entraExtensionIssuer);
  if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.ciamlogin.com') || issuer.pathname !== `/${p.entraExternalTenantId}/v2.0`) throw new Error('Exact customer tenant issuer required');
  const sweep = new URL(p.examSweepUrl);
  if (sweep.protocol !== 'https:' || sweep.pathname !== '/api/v1/internal/exams/sweep' || sweep.search || sweep.hash || sweep.username || sweep.password) throw new Error('Invalid sweep URL');
  if (p.examSweepEnabled === true && !schedulerReceipt) throw new Error('Scheduler activation requires a reviewed legacy scheduler disabled receipt');
  if (!/^\d{4}-\d{2}-01T00:00:00Z$/.test(p.budgetStartDate ?? '')) throw new Error('Budget start must be first of month');
  return true;
}
export function scopePreflight({ run = az } = {}) {
  validateAccount(run(['account','show']));
  const group=run(['group','show','--name',policy.resourceGroup,'--subscription',policy.subscriptionId]);
  const expected=`/subscriptions/${policy.subscriptionId}/resourceGroups/${policy.resourceGroup}`;
  if(group.location!==policy.location||String(group.id).toLowerCase()!==expected.toLowerCase())throw new Error('Wrong Academy resource group scope or region');
  return group;
}
export function migrationTargetChecks(outputs,{ prepare = false, run = az } = {}) {
  const storage=outputs.storageAccountName?.value,vault=outputs.vaultName?.value;
  if(!/^vfast[a-z0-9]{13}$/.test(storage??'')||!/^vfakv[a-z0-9]{13}$/.test(vault??''))throw new Error('Unexpected Academy migration resource names');
  const scope=`/subscriptions/${policy.subscriptionId}/resourceGroups/${policy.resourceGroup}`;
  const storageId=`${scope}/providers/Microsoft.Storage/storageAccounts/${storage}`;
  const account=run(['resource','show','--ids',storageId,'--subscription',policy.subscriptionId]);
  if(String(account.id).toLowerCase()!==storageId.toLowerCase())throw new Error('Migration storage outside Academy scope');
  if(!prepare)return{storage,vault};
  for(const namespace of ['Microsoft.App','Microsoft.ManagedIdentity','Microsoft.Storage','Microsoft.KeyVault','Microsoft.Network','Microsoft.DBforPostgreSQL']){
    const provider=run(['provider','show','--namespace',namespace,'--subscription',policy.subscriptionId]);
    if(provider.registrationState!=='Registered')throw new Error(`Migration provider not registered: ${namespace}`);
  }
  const vaultId=`${scope}/providers/Microsoft.KeyVault/vaults/${vault}`;
  const actualVault=run(['resource','show','--ids',vaultId,'--subscription',policy.subscriptionId]);
  if(String(actualVault.id).toLowerCase()!==vaultId.toLowerCase())throw new Error('Migration vault outside Academy scope');
  const postgresName=outputs.postgresName?.value,environmentName=outputs.environmentName?.value;
  if(!/^vfa-[a-z0-9-]+-pg-[a-z0-9]{13}$/.test(postgresName??'')||!/^vfa-[a-z0-9-]+-environment$/.test(environmentName??''))throw new Error('Unexpected migration network/database target');
  const pg=run(['postgres','flexible-server','show','--name',postgresName,'--resource-group',policy.resourceGroup,'--subscription',policy.subscriptionId]);
  if(pg.version!=='17'||pg.sku?.name!=='Standard_B1ms'||pg.network?.publicNetworkAccess!=='Disabled'||!String(pg.network?.delegatedSubnetResourceId).toLowerCase().startsWith(scope.toLowerCase()+'/providers/microsoft.network/virtualnetworks/'))throw new Error('Migration requires the approved private PostgreSQL17 B1ms target');
  const environment=run(['containerapp','env','show','--name',environmentName,'--resource-group',policy.resourceGroup,'--subscription',policy.subscriptionId]);
  const subnet=environment.properties?.vnetConfiguration?.infrastructureSubnetId;
  if(!String(subnet).toLowerCase().startsWith(scope.toLowerCase()+'/providers/microsoft.network/virtualnetworks/'))throw new Error('Migration Container Apps environment has no approved private VNet');
  return{storage,vault};
}
export function preflight({ email = false } = {}) {
  const group = scopePreflight();
  for (const namespace of ['Microsoft.DBforPostgreSQL', 'Microsoft.App', 'Microsoft.Web', 'Microsoft.Network', 'Microsoft.KeyVault', 'Microsoft.Storage', 'Microsoft.Communication', ...(email ? ['Microsoft.EventGrid'] : []), 'Microsoft.ManagedIdentity', 'Microsoft.Consumption']) {
    const provider = az(['provider', 'show', '--namespace', namespace, '--subscription', policy.subscriptionId]);
    if (provider.registrationState !== 'Registered') throw new Error(`Provider not registered: ${namespace}`);
  }
  const skus = az(['postgres', 'flexible-server', 'list-skus', '--location', policy.location, '--subscription', policy.subscriptionId]);
  const encoded = JSON.stringify(skus);
  if (!encoded.includes('Standard_B1ms') || !encoded.includes('"17"')) throw new Error('PostgreSQL 17/B1ms capacity not advertised; do not auto-upgrade');
  const locations = az(['functionapp', 'list-flexconsumption-locations']);
  if (!locations.some(item => [item.name, item.id].some(value => String(value).toLowerCase().replaceAll(' ', '') === policy.location))) throw new Error('Flex Consumption not advertised in Southeast Asia');
  return { scope: group.id, checks: 'read-only prerequisites', benefits: benefitStatus(), capacityGuaranteed: false, liveDeploymentVerified: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(preflight(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

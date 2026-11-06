#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const customerTenant = 'f3152aa5-61de-40fd-bb76-780b9fbe5428';
const workforceTenant = '157419c9-2de9-45e7-a6f9-91546dbef629';
const flowId = '76c08150-f837-47b9-b793-f119e781d283';

export function entryCollectionPatch(flow) {
  if (flow.id !== flowId || flow.displayName !== 'AcademySignIn'
    || !flow.conditions?.applications?.includeApplications?.some(app => app.appId === '88634bca-540c-4d38-8061-3d8e0f43bfd3')) throw new Error('Unexpected Academy flow');
  const collection = structuredClone(flow.onAttributeCollection);
  const inputs = collection?.attributeCollectionPage?.views?.flatMap(view => view.inputs ?? []) ?? [];
  const names = inputs.filter(input => input.attribute === 'displayName');
  if (names.length !== 1 || !inputs.some(input => input.attribute === 'email' && input.hidden === true)) throw new Error('Unexpected collection fields');
  Object.assign(names[0], { hidden: true, editable: true, required: false, writeToDirectory: true });
  // Attribute definitions are a read projection; patch only the page configuration.
  return { '@odata.type': '#microsoft.graph.externalUsersSelfServiceSignUpEventsFlow', onAttributeCollection: {
    '@odata.type': '#microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp',
    attributeCollectionPage: collection.attributeCollectionPage,
  } };
}

export function workforceClaimsPatch(app) {
  if (app.signInAudience !== 'AzureADMyOrg') throw new Error('Workforce app must remain single tenant');
  const optionalClaims = structuredClone(app.optionalClaims ?? {});
  optionalClaims.idToken ??= [];
  for (const name of ['upn', 'acct']) {
    const matches = optionalClaims.idToken.filter(claim => claim.name === name);
    if (matches.length > 1 || matches.some(claim => claim.source || claim.additionalProperties?.length)) throw new Error('Unexpected workforce claim override');
    if (!matches.length) optionalClaims.idToken.push({ name, essential: false, additionalProperties: [] });
  }
  return { optionalClaims };
}

function graph(tenant) {
  const { accessToken } = JSON.parse(execFileSync('az', ['account', 'get-access-token', '--tenant', tenant, '--resource', 'https://graph.microsoft.com', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  return async (path, method = 'GET', body) => {
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(`Graph ${method} ${path.split('?')[0]} failed (${response.status}): ${failure.error?.code ?? 'unknown'} ${failure.error?.message ?? ''}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

async function main() {
  const { loadEnvConfig } = (await import('@next/env')).default;
  loadEnvConfig(process.cwd());
  const appId = process.env.MICROSOFT_ENTRA_CLIENT_ID;
  if (!/^[a-f0-9-]{36}$/i.test(appId ?? '')) throw new Error('Workforce application ID required');
  const customer = graph(customerTenant), workforce = graph(workforceTenant);
  const flow = await customer(`/identity/authenticationEventsFlows/${flowId}`);
  const apps = await workforce(`/applications?$filter=appId eq '${appId}'&$select=id,appId,displayName,signInAudience,optionalClaims`);
  if (apps.value?.length !== 1) throw new Error('Workforce application not found');
  const app = apps.value[0];
  const collection = entryCollectionPatch(flow), claims = workforceClaimsPatch(app);
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ dryRun: true, flow: flow.displayName, workforce: app.displayName, collection, claims })); return; }
  const directory = resolve('build/azure-core/private');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const backup = `${directory}/entry-flow-before-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ flowId, onAttributeCollection: flow.onAttributeCollection, workforceObjectId: app.id, optionalClaims: app.optionalClaims }, null, 2), { mode: 0o600, flag: 'wx' });
  // Configure required claims first; hiding a field must not leave staff claims absent.
  await workforce(`/applications/${app.id}`, 'PATCH', claims);
  await customer(`/identity/authenticationEventsFlows/${flowId}`, 'PATCH', collection);
  const after = await customer(`/identity/authenticationEventsFlows/${flowId}`);
  if (!isDeepStrictEqual(after.onAttributeCollection.attributeCollectionPage, collection.onAttributeCollection.attributeCollectionPage)) throw new Error('Collection readback differs');
  const appAfter = await workforce(`/applications/${app.id}?$select=signInAudience,optionalClaims`);
  if (!isDeepStrictEqual(appAfter.optionalClaims, claims.optionalClaims)) throw new Error('Claims readback differs');
  console.log(JSON.stringify({ configured: true, backup, hostedSignupVerified: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main().catch(error => { console.error(error.message); process.exitCode = 1; });

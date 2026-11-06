import 'server-only';
import { createHash } from 'node:crypto';
import { adminAccountsConfigured, CUSTOMER_ISSUER, CUSTOMER_TENANT } from './admin-graph';
import { IdentityGrantRejected } from './oidc';
import { identityDisplayName } from './display-name';
import type { GoogleIdentity } from './google';

const DOMAIN = 'vfutureacademy.onmicrosoft.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type GoogleDirectoryBinding = { issuer: string; objectId: string };
type DirectoryUser = { id?: unknown; accountEnabled?: unknown; identities?: { signInType?: string; issuer?: string; issuerAssignedId?: string }[] };
type Environment = Readonly<Record<string,string|undefined>>;
/** No email linking: Google sub → exact federated identity → pinned Entra object ID. */
export function createGoogleDirectory(env: Environment = process.env, request: typeof fetch = fetch) {
  if (!adminAccountsConfigured(env) || env.ENTRA_ISSUER !== CUSTOMER_ISSUER) throw new Error('Google directory binding is not configured');
  let token: string|undefined;
  async function call(path: string, method = 'GET', body?: unknown): Promise<Record<string,unknown>> {
    if (!token) {
      const response = await request(`https://login.microsoftonline.com/${CUSTOMER_TENANT}/oauth2/v2.0/token`, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type:'client_credentials',client_id:env.ENTRA_ADMIN_CLIENT_ID!,client_secret:env.ENTRA_ADMIN_CLIENT_SECRET!,scope:'https://graph.microsoft.com/.default' }) });
      if (!response.ok) throw new Error('Google directory authorization unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('access_token' in data) || typeof data.access_token !== 'string' || !data.access_token) throw new Error('Google directory authorization unavailable');
      token = data.access_token;
    }
    const response = await request(`https://graph.microsoft.com/v1.0${path}`, { method, redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}) });
    if (!response.ok) throw new Error('Google directory operation failed');
    const text = await response.text();
    if (text.length > 262144) throw new Error('Invalid Google directory response');
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Google directory response');
    return data as Record<string,unknown>;
  }
  async function lookup(filter: string): Promise<DirectoryUser[]> {
    const query = new URLSearchParams({ '$select':'id,accountEnabled,identities','$filter':filter,'$top':'2' });
    const data = await call(`/users?${query}`);
    if (!Array.isArray(data.value) || data.value.length > 1 || data['@odata.nextLink'] || !data.value.every(value=>value&&typeof value==='object'&&!Array.isArray(value))) throw new Error('Ambiguous Google directory identity');
    return data.value as DirectoryUser[];
  }
  function binding(row: DirectoryUser, identity: GoogleIdentity): GoogleDirectoryBinding {
    if (row.accountEnabled !== true) throw new IdentityGrantRejected();
    if (typeof row.id !== 'string' || !UUID.test(row.id) || !Array.isArray(row.identities) || !row.identities.some(value=>value.signInType==='federated'&&value.issuer==='google.com'&&value.issuerAssignedId===identity.subject)) throw new Error('Google directory identity mismatch');
    return { issuer: CUSTOMER_ISSUER, objectId: row.id };
  }
  return {
    async resolve(identity: GoogleIdentity, allowCreate: boolean): Promise<GoogleDirectoryBinding> {
      if (identity.issuer !== 'https://accounts.google.com' || !/^[0-9]{1,64}$/.test(identity.subject) || identity.emailVerified !== true) throw new Error('Invalid Google directory identity');
      const filter = `identities/any(i:i/issuer eq 'google.com' and i/issuerAssignedId eq '${identity.subject}')`;
      const existing = await lookup(filter);
      if (existing.length) return binding(existing[0],identity);
      if (!allowCreate) throw new IdentityGrantRejected();
      // A matching email is only a collision signal. Never select that account.
      const email = identity.email.toLowerCase().replaceAll("'","''");
      if ((await lookup(`mail eq '${email}'`)).length || (await lookup(`identities/any(i:i/issuer eq '${DOMAIN}' and i/issuerAssignedId eq '${email}')`)).length) throw new Error('Identity mapping required');
      const nickname = `google-${createHash('sha256').update(identity.subject).digest('hex').slice(0,32)}`;
      const displayName = identityDisplayName({name:identity.name,given_name:identity.givenName,family_name:identity.familyName}) || 'Academy learner';
      try {
        await call('/users','POST',{accountEnabled:true,displayName,mailNickname:nickname,mail:identity.email,
          identities:[{signInType:'federated',issuer:'google.com',issuerAssignedId:identity.subject}]});
      } catch (error) {
        // A concurrent callback can win the unique federated-identity creation.
        // Recovery still requires reading and validating exactly the same sub.
        const recovered = await lookup(filter);
        if (!recovered.length) throw error;
        return binding(recovered[0],identity);
      }
      const created = await lookup(filter);
      if (!created.length) throw new Error('Google directory binding unavailable');
      return binding(created[0],identity);
    },
  };
}

// Server-only boundary: node:crypto cannot run in the browser; this module is also
// used by operator scripts, which cannot load Next's server-only marker.
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

type Source = Readonly<Record<string, string | undefined>>;
export type DatabaseRole = 'authenticated' | 'service_role';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Never accepts an externally supplied role or provider subject. */
export function signDatabaseToken(role: DatabaseRole, userId?: string, source: Source = process.env, now = Math.floor(Date.now() / 1000)) {
  if (role !== 'authenticated' && role !== 'service_role') throw new Error('Invalid database role');
  if ((role === 'authenticated' && !userId) || (userId && !uuid.test(userId))) throw new Error('Verified Academy identity required');
  const secret = source.AZURE_POSTGREST_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Invalid AZURE_POSTGREST_JWT_SECRET');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role, ...(userId ? { sub: userId } : {}), iss: 'academy-server', aud: 'academy-data', iat: now, exp: now + 60 })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** Query builders stay source-compatible. Only the PostgREST transport is exposed. */
export function createAzureDataClient(role: DatabaseRole, userId?: string, source: Source = process.env, fetcher: typeof fetch = fetch) {
  let endpoint: URL;
  try { endpoint = new URL(source.AZURE_POSTGREST_URL ?? ''); } catch { throw new Error('Invalid AZURE_POSTGREST_URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Invalid AZURE_POSTGREST_URL');
  const origin = endpoint.origin;
  return createClient(origin, 'azure-server-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => signDatabaseToken(role, userId, source),
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/')) throw new Error('Azure data client supports PostgREST only');
      url.pathname = url.pathname.slice('/rest/v1'.length);
      const headers = new Headers(init?.headers);
      headers.delete('apikey');
      return fetcher(url.toString(), { ...init, headers });
    } },
  });
}

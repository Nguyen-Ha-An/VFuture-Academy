import type { ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';

const HOSTED_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
]);
const CHATGPT_CALLBACK_PREFIX = 'https://chatgpt.com/connector/oauth/';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CLIENT_CACHE_MS = 5 * 60_000;
const CLIENT_CACHE_MAX = 1_000;
const CLIENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isAllowedMcpRedirectUri(uri: string): boolean {
  if (HOSTED_REDIRECTS.has(uri)) return true;
  // OpenAI documents this callback-ID path, but not its ID charset or length.
  // Restrict it locally to one 8–128 character base64url-style path segment.
  if (uri.startsWith(CHATGPT_CALLBACK_PREFIX)) {
    const callbackId = uri.slice(CHATGPT_CALLBACK_PREFIX.length);
    return callbackId.length >= 8 && callbackId.length <= 128
      && !/[^A-Za-z0-9_-]/u.test(callbackId);
  }
  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { return false; }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)
    || !parsed.port || parsed.pathname !== '/callback' || parsed.search || parsed.hash
    || parsed.username || parsed.password) return false;
  return parsed.href === uri;
}

type ClientLookupDatabase = Pick<ReadOnlyDatabase, 'auth'>;
const allowedClients = new Map<string, { allowed: boolean; expiresAt: number }>();

/** Checks every registered redirect URI; one hostile callback invalidates the whole client. */
export async function validateMcpClient(db: ClientLookupDatabase, clientId: string): Promise<void> {
  if (!CLIENT_ID.test(clientId)) throw new StudioMcpError('UNAUTHENTICATED');
  const cached = allowedClients.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.allowed) throw new StudioMcpError('UNAUTHENTICATED');
    return;
  }
  let result: Awaited<ReturnType<ClientLookupDatabase['auth']['admin']['oauth']['getClient']>>;
  try { result = await db.auth.admin.oauth.getClient(clientId); }
  catch { throw new StudioMcpError('SERVICE_UNAVAILABLE'); }
  const { data, error } = result;
  if (error) {
    const status = (error as { status?: unknown }).status;
    throw new StudioMcpError(status === 404 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE');
  }
  const client = data as { client_id?: unknown; redirect_uris?: unknown } | null;
  const uris = client?.redirect_uris;
  const allowed = client?.client_id === clientId && Array.isArray(uris) && uris.length > 0
    && uris.every((uri) => typeof uri === 'string' && isAllowedMcpRedirectUri(uri));
  if (allowedClients.size >= CLIENT_CACHE_MAX) allowedClients.delete(allowedClients.keys().next().value!);
  allowedClients.set(clientId, { allowed, expiresAt: Date.now() + CLIENT_CACHE_MS });
  if (!allowed) throw new StudioMcpError('UNAUTHENTICATED');
}

export function resetMcpClientCacheForTests(): void {
  allowedClients.clear();
}

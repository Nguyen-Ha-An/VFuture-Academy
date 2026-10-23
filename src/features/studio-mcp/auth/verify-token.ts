import { StudioMcpError } from '../errors';

type FetchJwks = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
export type McpAuthClient = {
  getClaims(token: string): Promise<{ data: { claims: unknown; header: unknown } | null; error: unknown | null }>;
  getUser(token: string): Promise<{ data: { user: { id?: unknown } | null } | null; error: unknown | null }>;
};

export type VerifiedMcpToken = {
  userId: string;
  clientId: string;
  sessionId: string;
  expiresAt: number;
};

const JWT_PART = /^[A-Za-z0-9_-]+$/;
const MAX_JWT_BYTES = 8 * 1024;
const JWKS_CACHE_MS = 60_000;
const MAX_JWKS_KEYS = 32;
const MAX_NEGATIVE_KIDS = 1_024;

type JwksCache = { fetchedAt: number; kids: Set<string>; negativeKids: Set<string> };
const jwksByIssuer = new Map<string, JwksCache>();

function rememberUnknownKid(cache: JwksCache, kid: string): void {
  if (cache.negativeKids.size >= MAX_NEGATIVE_KIDS) {
    cache.negativeKids.delete(cache.negativeKids.values().next().value!);
  }
  cache.negativeKids.add(kid);
}

function parseJwtHeader(token: string): { kid: string } {
  if (Buffer.byteLength(token, 'utf8') > MAX_JWT_BYTES) throw new StudioMcpError('UNAUTHENTICATED');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !JWT_PART.test(part))) throw new StudioMcpError('UNAUTHENTICATED');
  let header: JwtHeader;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as JwtHeader; }
  catch { throw new StudioMcpError('UNAUTHENTICATED'); }
  if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string' || !JWT_PART.test(header.kid)
    || header.kid.length > 128 || (header.typ !== undefined && header.typ !== 'JWT')) {
    throw new StudioMcpError('UNAUTHENTICATED');
  }
  return { kid: header.kid };
}

async function checkKid(kid: string, supabaseUrl: string, fetchJwks: FetchJwks): Promise<void> {
  const issuer = new URL('/auth/v1', supabaseUrl).href;
  const cached = jwksByIssuer.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_MS) {
    if (!cached.kids.has(kid)) {
      rememberUnknownKid(cached, kid);
      throw new StudioMcpError('UNAUTHENTICATED');
    }
    return;
  }
  let keys: unknown;
  try {
    const response = await fetchJwks(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl).href, { cache: 'no-store' });
    if (!response.ok) throw new Error('JWKS unavailable');
    keys = (await response.json() as { keys?: unknown }).keys;
  } catch {
    throw new StudioMcpError('SERVICE_UNAVAILABLE');
  }
  if (!Array.isArray(keys) || keys.length > MAX_JWKS_KEYS) throw new StudioMcpError('SERVICE_UNAVAILABLE');
  const kids = new Set(keys.flatMap((key) => {
    const entry = key as { kid?: unknown; kty?: unknown; crv?: unknown; alg?: unknown };
    return entry && entry.kty === 'EC' && entry.crv === 'P-256' && (entry.alg === undefined || entry.alg === 'ES256')
      && typeof entry.kid === 'string' && JWT_PART.test(entry.kid) ? [entry.kid] : [];
  }));
  jwksByIssuer.set(issuer, { fetchedAt: Date.now(), kids, negativeKids: new Set() });
  if (!kids.has(kid)) {
    rememberUnknownKid(jwksByIssuer.get(issuer)!, kid);
    throw new StudioMcpError('UNAUTHENTICATED');
  }
}

function validClaims(value: unknown, expectedIssuer: string): VerifiedMcpToken {
  const object = value as Record<string, unknown> | null;
  const now = Math.floor(Date.now() / 1000);
  const audience = object?.aud;
  if (!object || object.iss !== expectedIssuer
    || !(audience === 'authenticated' || Array.isArray(audience) && audience.includes('authenticated'))
    || object.role !== 'authenticated'
    || typeof object.exp !== 'number' || !Number.isSafeInteger(object.exp) || object.exp <= now
    || typeof object.iat !== 'number' || !Number.isSafeInteger(object.iat) || object.iat > now + 60
    || typeof object.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(object.sub)
    || typeof object.client_id !== 'string' || object.client_id.length === 0
    || typeof object.session_id !== 'string' || object.session_id.length === 0
    || object.is_anonymous === true) throw new StudioMcpError('UNAUTHENTICATED');
  return { userId: object.sub, clientId: object.client_id, sessionId: object.session_id, expiresAt: object.exp };
}

/** Signature verification is performed by Supabase getClaims after cheap local rejection. */
export async function verifyMcpToken(
  token: string,
  auth: McpAuthClient,
  options: { supabaseUrl: string; fetchJwks?: FetchJwks },
): Promise<VerifiedMcpToken> {
  const { kid } = parseJwtHeader(token);
  await checkKid(kid, options.supabaseUrl, options.fetchJwks ?? fetch);
  let result: Awaited<ReturnType<McpAuthClient['getClaims']>>;
  try { result = await auth.getClaims(token); }
  catch { throw new StudioMcpError('UNAUTHENTICATED'); }
  if (result.error || !result.data) throw new StudioMcpError('UNAUTHENTICATED');
  const verifiedHeader = result.data.header as JwtHeader | null;
  if (verifiedHeader?.alg !== 'ES256' || verifiedHeader.kid !== kid) throw new StudioMcpError('UNAUTHENTICATED');
  const verified = validClaims(result.data.claims, new URL('/auth/v1', options.supabaseUrl).href);
  let userResult: Awaited<ReturnType<McpAuthClient['getUser']>>;
  try { userResult = await auth.getUser(token); }
  catch { throw new StudioMcpError('UNAUTHENTICATED'); }
  if (userResult.error || userResult.data?.user?.id !== verified.userId) throw new StudioMcpError('UNAUTHENTICATED');
  return verified;
}

export function resetMcpJwksCacheForTests(): void {
  jwksByIssuer.clear();
}

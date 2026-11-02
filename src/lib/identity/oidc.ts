import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';
import { POPUP_ATTEMPT_PATTERN } from './popup-contract';
import { safeInternalPath } from '@/lib/safe-internal-path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MICROSOFT_WORKFORCE_TENANT = '157419c9-2de9-45e7-a6f9-91546dbef629';
export type IdentityProvider = 'external-id' | 'microsoft';
export function isIdentityProvider(value: unknown): value is IdentityProvider { return value === 'external-id' || value === 'microsoft'; }
export type IdentityConfiguration = {
  provider: IdentityProvider;
  tenantId: string; clientId: string; clientSecret: string; issuer: string; authority: string;
  redirectUri: string; appOrigin: string; encryptionKey: Buffer; sessionMaxAge: number;
  googleDomainHint?: string;
};
export type LoginTransaction = { popupAttempt?: string; provider: IdentityProvider; state: string; nonce: string; verifier: string; next: string };
export type OidcMetadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; end_session_endpoint: string };
export type IdentityClaims = Record<string, unknown> & { sub: string; oid: string; iss: string; exp: number; iat: number };

function secureUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid identity endpoint');
  return url;
}
export function readIdentityIssuerConfiguration(source: Readonly<Record<string, string | undefined>> = process.env) {
  const tenantId = source.ENTRA_TENANT_ID || '';
  if (!UUID.test(tenantId)) throw new Error('Invalid identity tenant');
  return { tenantId, issuer: secureUrl(source.ENTRA_ISSUER || '').toString().replace(/\/$/, ''), authority: secureUrl(source.ENTRA_AUTHORITY || '').toString().replace(/\/$/, '') };
}
/** Shared cookie/application settings, independent of either provider's client credential. */
export function readIdentitySessionConfiguration(source: Readonly<Record<string, string | undefined>> = process.env) {
  const required = (key: string) => { const value = source[key]?.trim(); if (!value) throw new Error(`Missing identity configuration: ${key}`); return value; };
  const appUrl = new URL(required('NEXT_PUBLIC_APP_URL'));
  if (appUrl.protocol !== 'https:' && !(source.NODE_ENV !== 'production' && appUrl.hostname === 'localhost' && appUrl.protocol === 'http:')) throw new Error('Invalid application origin');
  const encryptionKey = Buffer.from(required('ENTRA_SESSION_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) throw new Error('ENTRA_SESSION_ENCRYPTION_KEY must contain 32 random bytes');
  const sessionMaxAge = Number(source.ENTRA_SESSION_MAX_AGE_SECONDS || '86400');
  if (!Number.isInteger(sessionMaxAge) || sessionMaxAge < 3600 || sessionMaxAge > 86400) throw new Error('Invalid session maximum age');
  return { encryptionKey, sessionMaxAge, appOrigin: appUrl.origin, redirectUri: new URL('/auth/callback', appUrl.origin).toString() };
}
export function readIdentityConfiguration(source: Readonly<Record<string, string | undefined>> = process.env, provider: IdentityProvider = 'external-id'): IdentityConfiguration {
  const required = (key: string) => { const value = source[key]?.trim(); if (!value) throw new Error(`Missing identity configuration: ${key}`); return value; };
  if (!isIdentityProvider(provider)) throw new Error('Invalid identity provider');
  const microsoft = provider === 'microsoft';
  const tenantId = required(microsoft ? 'MICROSOFT_ENTRA_TENANT_ID' : 'ENTRA_TENANT_ID');
  if (microsoft && tenantId !== MICROSOFT_WORKFORCE_TENANT) throw new Error('Microsoft sign-in requires the approved workforce tenant');
  const clientId = required(microsoft ? 'MICROSOFT_ENTRA_CLIENT_ID' : 'ENTRA_CLIENT_ID');
  if (microsoft && clientId === source.ENTRA_CLIENT_ID) throw new Error('Microsoft sign-in requires its separate application');
  if (!UUID.test(tenantId) || !UUID.test(clientId)) throw new Error('Invalid identity tenant or client');
  const issuer = microsoft ? `https://login.microsoftonline.com/${tenantId}/v2.0` : secureUrl(required('ENTRA_ISSUER')).toString().replace(/\/$/, '');
  const authority = microsoft ? issuer : secureUrl(required('ENTRA_AUTHORITY')).toString().replace(/\/$/, '');
  const session = readIdentitySessionConfiguration(source);
  return { provider, tenantId, clientId, clientSecret: required(microsoft ? 'MICROSOFT_ENTRA_CLIENT_SECRET' : 'ENTRA_CLIENT_SECRET'), issuer, authority, ...session,
    googleDomainHint: microsoft ? undefined : source.ENTRA_GOOGLE_DOMAIN_HINT };
}
export function randomToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(value: string) { return createHash('sha256').update(value).digest('hex'); }

export function authorizationRequest(config: IdentityConfiguration, endpoint: string, input: { next?: string | null; provider?: string; mode?: string; popupAttempt?: string }) {
  const transaction: LoginTransaction = { ...(input.popupAttempt && POPUP_ATTEMPT_PATTERN.test(input.popupAttempt) ? { popupAttempt: input.popupAttempt } : {}), provider: config.provider, state: randomToken(), nonce: randomToken(), verifier: randomToken(), next: safeInternalPath(input.next) };
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', response_mode: 'query', redirect_uri: config.redirectUri,
    scope: 'openid profile email offline_access', state: transaction.state, nonce: transaction.nonce,
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url') }).toString();
  const hint = config.provider === 'external-id' && input.provider === 'google' ? config.googleDomainHint : undefined;
  if (hint) url.searchParams.set('domain_hint', hint);
  if (input.mode === 'recovery') url.searchParams.set('prompt', 'login');
  return { url: url.toString(), transaction };
}

export class IdentityGrantRejected extends Error {
  constructor() { super('Sign-in is required'); this.name = 'IdentityGrantRejected'; }
}
async function jsonRequest(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (text.length > 262144) throw new Error('Invalid identity response');
  if (!response.ok) {
    let failure: unknown; try { failure = JSON.parse(text); } catch { /* No provider details reach the caller. */ }
    if (response.status === 400 && init?.method === 'POST' && typeof failure === 'object' && failure !== null && 'error' in failure && failure.error === 'invalid_grant') throw new IdentityGrantRejected();
    throw new Error('Identity provider unavailable');
  }
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid identity response');
  return result as Record<string, unknown>;
}
const discoveryCache = new Map<string, { until: number; data: OidcMetadata }>();
const discoveryRequests = new Map<string, Promise<OidcMetadata>>();
const providerFailures = new Map<string, number>();
function checkProviderBackoff(key: string) {
  if ((providerFailures.get(key) || 0) > Date.now()) throw new Error('Identity provider unavailable');
}
function recordProviderFailure(key: string) {
  if (providerFailures.size >= 32) providerFailures.delete(providerFailures.keys().next().value!);
  providerFailures.set(key, Date.now() + 5000);
}
export async function getOidcMetadata(config: Pick<IdentityConfiguration, 'issuer' | 'authority'>): Promise<OidcMetadata> {
  const cacheKey = `${config.authority}|${config.issuer}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.data;
  checkProviderBackoff(cacheKey);
  const inflight = discoveryRequests.get(cacheKey);
  if (inflight) return inflight;
  const pending = (async () => {
    const data = await jsonRequest(`${config.authority}/.well-known/openid-configuration`);
    if (data.issuer !== config.issuer) throw new Error('Identity issuer mismatch');
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'end_session_endpoint']) {
      if (typeof data[field] !== 'string' || secureUrl(data[field]).origin !== new URL(config.authority).origin) throw new Error('Untrusted identity endpoint');
    }
    const metadata = data as OidcMetadata;
    if (discoveryCache.size >= 16) discoveryCache.delete(discoveryCache.keys().next().value!);
    discoveryCache.set(cacheKey, { until: Date.now() + 300000, data: metadata });
    return metadata;
  })();
  discoveryRequests.set(cacheKey, pending);
  try { return await pending; } catch (error) { recordProviderFailure(cacheKey); throw error; } finally { discoveryRequests.delete(cacheKey); }
}
const signingKeyCache = new Map<string, { until: number; keys: JsonWebKey[] }>();
const signingKeyRequests = new Map<string, Promise<JsonWebKey[]>>();
export async function getSigningKeys(metadata: OidcMetadata): Promise<JsonWebKey[]> {
  const uri = metadata.jwks_uri;
  const cached = signingKeyCache.get(uri);
  if (cached && cached.until > Date.now()) return cached.keys;
  checkProviderBackoff(uri);
  const inflight = signingKeyRequests.get(uri);
  if (inflight) return inflight;
  const pending = (async () => {
    const data = await jsonRequest(uri);
    if (!Array.isArray(data.keys) || data.keys.length > 100 || !data.keys.every(key => key && typeof key === 'object' && !Array.isArray(key))) throw new Error('Invalid signing keys');
    const keys = data.keys as JsonWebKey[];
    if (signingKeyCache.size >= 16) signingKeyCache.delete(signingKeyCache.keys().next().value!);
    signingKeyCache.set(uri, { until: Date.now() + 60000, keys });
    return keys;
  })();
  signingKeyRequests.set(uri, pending);
  try { return await pending; } catch (error) { recordProviderFailure(uri); throw error; } finally { signingKeyRequests.delete(uri); }
}
/** Signature only. Every caller must separately enforce its token's issuer, tenant, audience and lifetime. */
export function verifySignedJwt(token: string, keys: JsonWebKey[]): Record<string, unknown> {
  if (token.length > 32768) throw new Error('Invalid token');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw new Error('Invalid token algorithm');
  const matches = keys.filter(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
  if (matches.length !== 1 || (matches[0].key_ops !== undefined && (!Array.isArray(matches[0].key_ops) || !matches[0].key_ops.includes('verify')))) throw new Error('Invalid signing key');
  const key = createPublicKey({ key: matches[0], format: 'jwk' });
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid signature');
  const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Invalid claims');
  return claims as Record<string, unknown>;
}
export async function verifyIdToken(token: string, config: IdentityConfiguration, keys: JsonWebKey[], nonce?: string): Promise<IdentityClaims> {
  const claims = verifySignedJwt(token, keys);
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud.includes(config.clientId) && claims.azp === config.clientId : claims.aud === config.clientId;
  if ((config.provider === 'microsoft' && claims.ver !== '2.0') || claims.iss !== config.issuer || claims.tid !== config.tenantId || !audience || (claims.azp !== undefined && claims.azp !== config.clientId)
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || typeof claims.oid !== 'string' || !UUID.test(claims.oid)
    || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 30
    || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30))
    || (nonce !== undefined && claims.nonce !== nonce)) throw new Error('Invalid identity claims');
  return claims as IdentityClaims;
}
export async function exchangeTokens(config: IdentityConfiguration, metadata: OidcMetadata, grant: { code: string; verifier: string } | { refreshToken: string }) {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: 'openid profile email offline_access' });
  if ('code' in grant) {
    body.set('grant_type', 'authorization_code'); body.set('code', grant.code); body.set('code_verifier', grant.verifier); body.set('redirect_uri', config.redirectUri);
  } else { body.set('grant_type', 'refresh_token'); body.set('refresh_token', grant.refreshToken); }
  const result = await jsonRequest(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (typeof result.id_token !== 'string' || (result.refresh_token !== undefined && typeof result.refresh_token !== 'string')) throw new Error('Invalid token response');
  return { idToken: result.id_token, refreshToken: result.refresh_token as string | undefined };
}
export function encryptRefreshToken(token: string, sessionHash: string, config: IdentityConfiguration): string {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`${config.provider}:${sessionHash}`));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}
export function decryptRefreshToken(value: string, sessionHash: string, config: IdentityConfiguration): string {
  const parts = value.split('.'); if (parts.length !== 3) throw new Error('Invalid session credential');
  const [nonce, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, nonce); decipher.setAAD(Buffer.from(`${config.provider}:${sessionHash}`)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

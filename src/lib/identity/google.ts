import 'server-only';
import { createHash, type JsonWebKey } from 'node:crypto';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { identityDisplayName } from './display-name';
import { POPUP_ATTEMPT_PATTERN } from './popup-contract';
import { IdentityGrantRejected, randomToken, readIdentitySessionConfiguration, verifySignedJwt, type LoginTransaction } from './oidc';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_AUTHORIZATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const CLIENT_ID = /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;
const SUBJECT = /^[0-9]{1,64}$/;
export const GOOGLE_REFRESH_PREFIX = 'google-v1:';
export type GoogleConfiguration = ReturnType<typeof readIdentitySessionConfiguration> & { clientId: string; clientSecret: string };
/** A verified Google identity is deliberately distinct from Entra's oid/iss claims. */
export type GoogleIdentity = { issuer: typeof GOOGLE_ISSUER; subject: string; email: string; emailVerified: true; expiresAt: number; name?: string; givenName?: string; familyName?: string };
export type GoogleRefreshCredential = { clientId: string; subject: string; refreshToken?: string; email: string; displayName?: string };
export function readGoogleConfiguration(source: Readonly<Record<string,string|undefined>> = process.env): GoogleConfiguration {
  const clientId = source.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim() || '';
  if (!CLIENT_ID.test(clientId) || !clientSecret) throw new Error('Google sign-in is not configured');
  return { ...readIdentitySessionConfiguration(source), clientId, clientSecret };
}
export function googleAuthorizationRequest(config: GoogleConfiguration, input: { next?: string|null; popupAttempt?: string }) {
  const transaction: LoginTransaction = { provider: 'external-id', kind: 'google-v1', state: randomToken(), nonce: randomToken(), verifier: randomToken(), next: safeInternalPath(input.next),
    ...(input.popupAttempt && POPUP_ATTEMPT_PATTERN.test(input.popupAttempt) ? { popupAttempt: input.popupAttempt } : {}) };
  const url = new URL(GOOGLE_AUTHORIZATION);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirectUri, scope: 'openid profile email',
    state: transaction.state, nonce: transaction.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url'), access_type: 'offline', prompt:'select_account consent' }).toString();
  return { url: url.toString(), transaction };
}
async function googleJson(url: string, init?: RequestInit): Promise<Record<string,unknown>> {
  const response = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (text.length > 262144) throw new Error('Invalid Google response');
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new Error('Invalid Google response'); }
  if (!response.ok) {
    if (response.status === 400 && init?.method === 'POST' && result && typeof result === 'object' && 'error' in result && result.error === 'invalid_grant') throw new IdentityGrantRejected();
    throw new Error('Google sign-in unavailable');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Google response');
  return result as Record<string,unknown>;
}
let discovery: { until: number; data: { jwks_uri: string } } | undefined;
/** Google uses several origins. Pin complete endpoints, never a generic google.com suffix. */
export async function getGoogleMetadata(): Promise<{ jwks_uri: string }> {
  if (discovery && discovery.until > Date.now()) return discovery.data;
  const result = await googleJson(`${GOOGLE_ISSUER}/.well-known/openid-configuration`);
  if (result.issuer !== GOOGLE_ISSUER || result.authorization_endpoint !== GOOGLE_AUTHORIZATION || result.token_endpoint !== GOOGLE_TOKEN || result.jwks_uri !== GOOGLE_JWKS) throw new Error('Untrusted Google endpoint');
  const data = { jwks_uri: GOOGLE_JWKS };
  discovery = { until: Date.now() + 300000, data };
  return data;
}
export async function exchangeGoogleTokens(config: GoogleConfiguration, grant: { code: string; verifier: string } | { refreshToken: string }) {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret });
  if ('code' in grant) {
    body.set('grant_type','authorization_code'); body.set('code',grant.code); body.set('code_verifier',grant.verifier); body.set('redirect_uri',config.redirectUri);
  } else { body.set('grant_type','refresh_token'); body.set('refresh_token',grant.refreshToken); }
  const result = await googleJson(GOOGLE_TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if (typeof result.id_token !== 'string' || !result.id_token || result.id_token.length > 32768 || (result.refresh_token !== undefined && (typeof result.refresh_token !== 'string' || !result.refresh_token || result.refresh_token.length > 16384))) throw new Error('Invalid Google token response');
  return { idToken: result.id_token, refreshToken: result.refresh_token as string|undefined };
}
export async function verifyGoogleIdToken(token: string, config: GoogleConfiguration, keys: JsonWebKey[], nonce?: string): Promise<GoogleIdentity> {
  const claims = verifySignedJwt(token,keys);
  const now = Math.floor(Date.now()/1000);
  const audience = Array.isArray(claims.aud) ? claims.aud.includes(config.clientId) && claims.azp === config.clientId : claims.aud === config.clientId;
  if (![GOOGLE_ISSUER,'accounts.google.com'].includes(String(claims.iss)) || !audience || (claims.azp !== undefined && claims.azp !== config.clientId)
    || typeof claims.sub !== 'string' || !SUBJECT.test(claims.sub) || claims.email_verified !== true
    || typeof claims.email !== 'string' || claims.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now+30 || claims.iat > claims.exp
    || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now+30))
    || (nonce !== undefined && claims.nonce !== nonce)) throw new Error('Invalid Google identity claims');
  const profileString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0,160) : undefined;
  return { issuer: GOOGLE_ISSUER, subject: claims.sub, email: claims.email, emailVerified: true, expiresAt: claims.exp,
    name: profileString(claims.name), givenName: profileString(claims.given_name), familyName: profileString(claims.family_name) };
}
export function encodeGoogleRefresh(credential: GoogleRefreshCredential): string { return GOOGLE_REFRESH_PREFIX + JSON.stringify(credential); }
export function decodeGoogleRefresh(value: string): GoogleRefreshCredential {
  if (!value.startsWith(GOOGLE_REFRESH_PREFIX) || value.length > 20000) throw new Error('Invalid Google session credential');
  const data: unknown = JSON.parse(value.slice(GOOGLE_REFRESH_PREFIX.length));
  if (!data || typeof data !== 'object' || !('clientId' in data) || typeof data.clientId !== 'string' || !CLIENT_ID.test(data.clientId)
    || !('subject' in data) || typeof data.subject !== 'string' || !SUBJECT.test(data.subject)
    || !('email' in data) || typeof data.email !== 'string' || data.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
    || ('displayName' in data && (typeof data.displayName !== 'string' || data.displayName.length > 160))
    || ('refreshToken' in data && (typeof data.refreshToken !== 'string' || !data.refreshToken || data.refreshToken.length > 16384))) throw new Error('Invalid Google session credential');
  return { clientId: data.clientId, subject: data.subject, email: data.email, ...('displayName' in data ? { displayName: data.displayName as string } : {}), ...('refreshToken' in data ? { refreshToken: data.refreshToken as string } : {}) };
}

export function googleIdentityDisplayName(identity: GoogleIdentity) {
  return identityDisplayName({name:identity.name,given_name:identity.givenName,family_name:identity.familyName});
}

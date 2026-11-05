import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { authorizationRequest, readIdentityConfiguration, verifyIdToken, encryptRefreshToken, decryptRefreshToken, exchangeTokens } from '@/lib/identity/oidc';
import { academyBackend } from '@/lib/identity/provider';

const env = {
  ACADEMY_BACKEND: 'azure', NEXT_PUBLIC_ACADEMY_BACKEND: 'azure',
  ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111', ENTRA_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  ENTRA_CLIENT_SECRET: 'test-secret', ENTRA_ISSUER: 'https://example.ciamlogin.com/tenant/v2.0',
  ENTRA_AUTHORITY: 'https://example.ciamlogin.com/tenant/v2.0', NEXT_PUBLIC_APP_URL: 'https://academy.example',
  ENTRA_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const config = () => readIdentityConfiguration(env);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key1', use: 'sig', alg: 'RS256' };
const now = Math.floor(Date.now() / 1000);
function token(changes: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key1', ...headerChanges })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: env.ENTRA_ISSUER, aud: env.ENTRA_CLIENT_ID, tid: env.ENTRA_TENANT_ID, sub: 'external-sub', oid: '33333333-3333-4333-8333-333333333333', nonce: 'nonce1', iat: now, exp: now + 3600, ...changes })).toString('base64url');
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`;
}
describe('Azure identity protocol boundaries', () => {
  beforeEach(() => vi.unstubAllEnvs());
  it('keeps Supabase default and rejects split server/browser cutover', () => {
    expect(academyBackend({})).toBe('supabase');
    expect(() => academyBackend({ ACADEMY_BACKEND: 'azure' })).toThrow();
    expect(academyBackend(env)).toBe('azure');
  });
  it('uses PKCE S256 and never accepts an external return location', () => {
    const auth = authorizationRequest(config(), 'https://example.ciamlogin.com/authorize', { next: 'https://attacker.example', provider: 'password' });
    const url = new URL(auth.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('nonce')).toBe(auth.transaction.nonce);
    expect(auth.transaction.next).toBe('/app');
    expect(auth.transaction.verifier.length).toBeGreaterThanOrEqual(43);
  });
  it('sends the exact case-sensitive Google federation hint for legacy and missing settings', () => {
    for (const hint of [undefined, 'google.com', 'google', 'Google']) {
      const cfg=readIdentityConfiguration({...env,ENTRA_GOOGLE_DOMAIN_HINT:hint});
      const url=new URL(authorizationRequest(cfg,'https://example.ciamlogin.com/authorize',{provider:'google'}).url);
      expect(url.searchParams.get('domain_hint')).toBe('Google');
    }
  });
  it('verifies signed claims with exact tenant, audience, issuer and nonce', async () => {
    const claims = await verifyIdToken(token(), config(), [jwk], 'nonce1');
    expect(claims.sub).toBe('external-sub');
    for (const change of [{ iss: 'https://attacker.example' }, { aud: 'other' }, { tid: 'other' }, { nonce: 'bad' }, { exp: now - 60 }, { nbf: now + 600 }, { sub: '' }, { aud: [env.ENTRA_CLIENT_ID, 'other'], azp: 'other' }]) {
      await expect(verifyIdToken(token(change), config(), [jwk], 'nonce1')).rejects.toThrow();
    }
    await expect(verifyIdToken(token({}, { alg: 'none' }), config(), [jwk], 'nonce1')).rejects.toThrow();
    await expect(verifyIdToken(token().split('.').map((part, i) => i === 2 ? (part[0] === 'A' ? 'B' : 'A') + part.slice(1) : part).join('.'), config(), [jwk], 'nonce1')).rejects.toThrow();
  });
  it('encrypts refresh tokens and binds ciphertext to its session', () => {
    const encrypted = encryptRefreshToken('provider-refresh-secret', 'session-a', config());
    expect(encrypted).not.toContain('provider-refresh-secret');
    expect(decryptRefreshToken(encrypted, 'session-a', config())).toBe('provider-refresh-secret');
    expect(() => decryptRefreshToken(encrypted, 'session-b', config())).toThrow();
  });
  it('refreshes native public-client grants without sending the confidential client secret',async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({id_token:'provider-id',refresh_token:'rotated'}));vi.stubGlobal('fetch',fetcher);
    try {
      await exchangeTokens(config(),{token_endpoint:'https://example.ciamlogin.com/token'} as Parameters<typeof exchangeTokens>[1],{refreshToken:'native-refresh',native:true});
      const body=fetcher.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('refresh_token')).toBe('native-refresh');expect(body.has('client_secret')).toBe(false);
    } finally {vi.unstubAllGlobals();}
  });
  it('rejects weak keys, insecure endpoints and tenant placeholders', () => {
    for (const change of [{ ENTRA_SESSION_ENCRYPTION_KEY: 'weak' }, { ENTRA_AUTHORITY: 'http://example.ciamlogin.com' }, { ENTRA_TENANT_ID: 'common' }, { ENTRA_ISSUER: '' }]) {
      expect(() => readIdentityConfiguration({ ...env, ...change })).toThrow();
    }
  });
});

it('coalesces concurrent signing-key reads so invalid-token traffic cannot fan out to Entra', async () => {
  const { getSigningKeys } = await import('@/lib/identity/oidc');
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ keys: [jwk] })));
  vi.stubGlobal('fetch', fetcher);
  const metadata = { issuer: env.ENTRA_ISSUER, authorization_endpoint: '', token_endpoint: '', end_session_endpoint: '', jwks_uri: 'https://test.ciamlogin.com/concurrent-test-keys' };
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => getSigningKeys(metadata)));
    expect(results.every(keys => keys[0].kid === 'key1')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await getSigningKeys(metadata))[0].kid).toBe('key1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

it('coalesces discovery and briefly backs off failed provider fetches without stale results', async () => {
  const { getOidcMetadata, getSigningKeys } = await import('@/lib/identity/oidc');
  const authority = 'https://discovery-test.ciamlogin.com/tenant/v2.0';
  const metadata = { issuer: env.ENTRA_ISSUER, authorization_endpoint: `${authority}/authorize`, token_endpoint: `${authority}/token`, end_session_endpoint: `${authority}/logout`, jwks_uri: `${authority}/keys` };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(metadata)));
  vi.stubGlobal('fetch', fetcher);
  try {
    await Promise.all(Array.from({ length: 10 }, () => getOidcMetadata({ authority, issuer: env.ENTRA_ISSUER })));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => new Response('{}', { status: 503 }));
    for (let count = 0; count < 3; count++) await expect(getSigningKeys(metadata)).rejects.toThrow('Identity provider unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});

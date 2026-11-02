import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findIdentityUser: vi.fn(), isMcpAccessBlocked: vi.fn(), getActorForUserId: vi.fn(), enforceRateLimit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-test-key' } }));
vi.mock('@/lib/identity/store', () => ({ findIdentityUser: mocks.findIdentityUser }));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ isMcpAccessBlocked: mocks.isMcpAccessBlocked }));
vi.mock('@/lib/permissions', async (original) => ({ ...(await original<typeof import('@/lib/permissions')>()), getActorForUserId: mocks.getActorForUserId }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit, RATE_LIMITS: { mcpRequest: {} }, userRateLimitKey: (_name: string, id: string) => id }));

import { resolveMcpPrincipal } from '@/features/studio-mcp/auth/principal';

const tenant = '11111111-1111-4111-8111-111111111111';
const audience = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const objectId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const issuer = `https://tenant.ciamlogin.com/${tenant}/v2.0`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'entra-key', alg: 'RS256', use: 'sig' }];
function token(overrides: Record<string, unknown> = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'entra-key', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, tid: tenant, aud: audience, azp: client, ver: '2.0', scp: 'Studio.Read', sub: 'pairwise-api-subject', oid: objectId, iat: now, nbf: now, exp: now + 600, ...overrides })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url')}`;
}
function principal(jwt = token()) {
  return resolveMcpPrincipal(new Request('https://academy.example/api/mcp', { headers: { authorization: `Bearer ${jwt}` } }), {} as never);
}

beforeEach(() => {
  vi.stubEnv('ACADEMY_BACKEND', 'azure');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
  vi.stubEnv('ENTRA_TENANT_ID', tenant);
  vi.stubEnv('ENTRA_ISSUER', issuer);
  vi.stubEnv('ENTRA_AUTHORITY', issuer);
  vi.stubEnv('STUDIO_MCP_ENTRA_AUDIENCE', audience);
  vi.stubEnv('STUDIO_MCP_ENTRA_SCOPE', `api://${audience}/Studio.Read`);
  vi.stubEnv('STUDIO_MCP_ENTRA_ALLOWED_CLIENT_IDS', client);
  mocks.findIdentityUser.mockReset().mockResolvedValue({ id: userId });
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
  mocks.getActorForUserId.mockReset().mockResolvedValue({ userId, roles: [], authorization: { accountStatus: 'active' } });
  mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json({ issuer, authorization_endpoint: 'https://tenant.ciamlogin.com/authorize', token_endpoint: 'https://tenant.ciamlogin.com/token', jwks_uri: 'https://tenant.ciamlogin.com/keys', end_session_endpoint: 'https://tenant.ciamlogin.com/logout' });
    if (url === 'https://tenant.ciamlogin.com/keys') return Response.json({ keys });
    throw new Error(`Unexpected network destination: ${url}`);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Entra MCP principal', () => {
  it('accepts a signed delegated API token and maps issuer + object ID to the stable Academy UUID', async () => {
    await expect(principal()).resolves.toMatchObject({ verified: { userId, clientId: client }, actor: { userId } });
    expect(mocks.findIdentityUser).toHaveBeenCalledWith(issuer, objectId);
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example/v2.0' }],
    ['another tenant', { tid: audience }],
    ['web ID-token audience', { aud: client }],
    ['multiple audiences', { aud: [audience, client] }],
    ['unauthorized client', { azp: audience }],
    ['missing client', { azp: undefined }],
    ['application-only token', { scp: undefined, roles: ['Studio.Read'] }],
    ['scope substring', { scp: 'Studio.ReadWrite' }],
    ['wrong token version', { ver: '1.0' }],
    ['expired token', { exp: 1 }],
    ['not yet valid', { nbf: 9999999999 }],
    ['future issuance', { iat: 9999999999 }],
    ['missing expiry', { exp: undefined }],
    ['missing object ID', { oid: undefined }],
    ['invalid object ID', { oid: 'email@example.com' }],
  ])('rejects %s before account mapping', async (_name, claims) => {
    await expect(principal(token(claims))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(mocks.findIdentityUser).not.toHaveBeenCalled();
  });

  it('rejects a token signed by an untrusted key', async () => {
    const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(principal(token({}, wrong))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('does not provision an unknown API identity', async () => {
    mocks.findIdentityUser.mockResolvedValue(null);
    await expect(principal()).rejects.toMatchObject({ code: 'ACCOUNT_NOT_PROVISIONED' });
  });
  it('fails closed when stable identity lookup is unavailable', async () => {
    mocks.findIdentityUser.mockRejectedValue(new Error('private storage outage'));
    await expect(principal()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
  it('enforces a fresh account block on an already issued valid token', async () => {
    const jwt = token();
    await principal(jwt);
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    await expect(principal(jwt)).rejects.toMatchObject({ code: 'MCP_ACCESS_BLOCKED' });
  });
  it('rejects a suspended account despite a valid token', async () => {
    mocks.getActorForUserId.mockResolvedValue({ userId, roles: [], authorization: { accountStatus: 'suspended' } });
    await expect(principal()).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });
  it('fails closed without the registered-client allowlist', async () => {
    vi.stubEnv('STUDIO_MCP_ENTRA_ALLOWED_CLIENT_IDS', '');
    await expect(principal()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyMcpToken: vi.fn(),
  validateMcpClient: vi.fn(),
  isMcpAccessBlocked: vi.fn(),
  enforceRateLimit: vi.fn(),
  getActorForUserId: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
}));
vi.mock('@/features/studio-mcp/auth/verify-token', () => ({ verifyMcpToken: mocks.verifyMcpToken }));
vi.mock('@/features/studio-mcp/auth/client-allowlist', () => ({ validateMcpClient: mocks.validateMcpClient }));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ isMcpAccessBlocked: mocks.isMcpAccessBlocked }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { mcpRequest: { limit: 300, windowSeconds: 60 } },
  enforceRateLimit: mocks.enforceRateLimit,
  userRateLimitKey: (scope: string, userId: string) => `${scope}:user:${userId}`,
}));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActorForUserId: mocks.getActorForUserId,
}));

import { resolveMcpPrincipal } from '@/features/studio-mcp/auth/principal';

const userId = '51bda642-e203-42e2-9f6e-fb0b2f5c4c77';
const GATEWAY_KEY = 'kT3vQ8n1Zp0xYw5uLr7sJc2bHd9eGf4aMi6oNq1VtXyAzBlCkD+EgFhIjKm/=';
const AUTH = { marker: 'mcp-auth' };
const AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
const request = () => new Request('https://academy.example/api/mcp', {
  headers: { authorization: 'Bearer valid-token' },
});
const database = {} as never;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('SUPABASE_GATEWAY_KEY', '');
  mocks.createClient.mockReset().mockReturnValue({ auth: AUTH });
  mocks.verifyMcpToken.mockReset().mockResolvedValue({ userId, clientId: 'client-1', sessionId: 'session-1', expiresAt: 9999999999 });
  mocks.validateMcpClient.mockReset().mockResolvedValue(undefined);
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
  mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.getActorForUserId.mockReset().mockResolvedValue({ userId, roles: [], authorization: { accountStatus: 'active' } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP auth client gateway key', () => {
  it('keeps the exact hosted-Supabase client and verification options when the key is unset', async () => {
    await resolveMcpPrincipal(request(), database);

    expect(mocks.createClient).toHaveBeenCalledWith('https://project.supabase.co', 'anon-key', { auth: AUTH_OPTIONS });
    expect(Object.keys(mocks.createClient.mock.calls[0][2] as object)).toEqual(['auth']);
    expect(mocks.verifyMcpToken).toHaveBeenCalledWith('valid-token', AUTH, { supabaseUrl: 'https://project.supabase.co' });
    expect(Object.keys(mocks.verifyMcpToken.mock.calls[0][2] as object)).toEqual(['supabaseUrl']);
  });

  it('sends the gateway key from the MCP auth client and from the JWKS fetch', async () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', upstream);

    await resolveMcpPrincipal(request(), database);

    expect(mocks.createClient).toHaveBeenCalledWith('https://project.supabase.co', 'anon-key', {
      auth: AUTH_OPTIONS,
      global: { headers: { 'x-vfuture-gateway-key': GATEWAY_KEY }, fetch: expect.any(Function) },
    });
    const verifyOptions = mocks.verifyMcpToken.mock.calls[0][2] as {
      supabaseUrl: string;
      fetchJwks: (url: string, init?: RequestInit) => Promise<unknown>;
    };
    await verifyOptions.fetchJwks('https://project.supabase.co/auth/v1/.well-known/jwks.json', { cache: 'no-store' });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/auth/v1/.well-known/jwks.json');
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).get('x-vfuture-gateway-key')).toBe(GATEWAY_KEY);
    vi.unstubAllGlobals();
  });

  it('does not create the key-bearing client when the caller injects its own auth client', async () => {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', GATEWAY_KEY);

    await resolveMcpPrincipal(request(), database, { auth: AUTH as never });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('fails closed without printing a malformed key', async () => {
    const secret = 'MALFORMED SECRET VALUE';
    vi.stubEnv('SUPABASE_GATEWAY_KEY', secret);

    const failure = await resolveMcpPrincipal(request(), database).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).not.toContain(secret);
    expect((failure as Error).message).toContain('SUPABASE_GATEWAY_KEY');
    expect(mocks.verifyMcpToken).not.toHaveBeenCalled();
  });
});

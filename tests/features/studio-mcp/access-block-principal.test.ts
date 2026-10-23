import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyMcpToken: vi.fn(),
  validateMcpClient: vi.fn(),
  isMcpAccessBlocked: vi.fn(),
  enforceRateLimit: vi.fn(),
  getActorForUserId: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } }));
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
const request = () => new Request('https://academy.example/api/mcp', {
  headers: { authorization: 'Bearer valid-token' },
});
const database = {} as never;

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.verifyMcpToken.mockReset().mockResolvedValue({ userId, clientId: 'client-1', sessionId: 'session-1', expiresAt: 9999999999 });
  mocks.validateMcpClient.mockReset().mockResolvedValue(undefined);
  mocks.isMcpAccessBlocked.mockReset().mockResolvedValue(false);
  mocks.enforceRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.getActorForUserId.mockReset().mockResolvedValue({ userId, roles: [], authorization: { accountStatus: 'active' } });
});

describe('MCP principal block admission', () => {
  it('returns a fixed 403 MCP_ACCESS_BLOCKED for a blocked user', async () => {
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    await expect(resolveMcpPrincipal(request(), database, { auth: {} as never }))
      .rejects.toMatchObject({ code: 'MCP_ACCESS_BLOCKED', status: 403 });
    expect(mocks.isMcpAccessBlocked).toHaveBeenCalledWith(userId, database);
  });

  it('fails closed when the block lookup is unavailable', async () => {
    mocks.isMcpAccessBlocked.mockRejectedValue(new Error('private database details'));
    await expect(resolveMcpPrincipal(request(), database, { auth: {} as never }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });

  it('checks the block again on the next exchange, including after a principal was accepted', async () => {
    await expect(resolveMcpPrincipal(request(), database, { auth: {} as never })).resolves.toMatchObject({ actor: { userId } });
    mocks.isMcpAccessBlocked.mockResolvedValue(true);
    await expect(resolveMcpPrincipal(request(), database, { auth: {} as never }))
      .rejects.toMatchObject({ code: 'MCP_ACCESS_BLOCKED', status: 403 });
    expect(mocks.isMcpAccessBlocked).toHaveBeenCalledTimes(2);
  });
});

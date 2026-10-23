import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  context: { actor: { userId: '11111111-1111-4111-8111-111111111111' }, scope: { kind: 'central' } },
  getAdminContext: vi.fn(),
  assertRequestScope: vi.fn(),
  assertAdminPermission: vi.fn(),
  supabaseService: vi.fn(),
  profileFrom: vi.fn(),
  profileQuery: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() },
  enforceRateLimit: vi.fn(),
  getMcpAccessBlock: vi.fn(),
  blockMcpAccess: vi.fn(),
  unblockMcpAccess: vi.fn(),
  audit: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/features/admin/context', () => ({
  getAdminContext: mocks.getAdminContext,
  assertRequestScope: mocks.assertRequestScope,
  assertAdminPermission: mocks.assertAdminPermission,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { mcpAdminBlock: { limit: 10, windowSeconds: 60 } },
  enforceRateLimit: mocks.enforceRateLimit,
  userRateLimitKey: (scope: string, id: string) => `${scope}:user:${id}`,
}));
vi.mock('@/features/studio-mcp/auth/access-block', () => ({ getMcpAccessBlock: mocks.getMcpAccessBlock }));
vi.mock('@/features/admin/mcp-access-blocks', () => ({
  blockMcpAccess: mocks.blockMcpAccess,
  unblockMcpAccess: mocks.unblockMcpAccess,
}));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/observability', () => ({ reportError: mocks.reportError }));

import { ApiError } from '@/lib/api';
import { DELETE, GET, POST } from '@/app/api/v1/admin/mcp/blocks/route';

const userId = '22222222-2222-4222-8222-222222222222';
const block = {
  userId,
  reason: 'Security review',
  blockedAt: '2026-09-26T00:00:00Z',
  blockedBy: mocks.context.actor.userId,
};
const endpoint = `https://academy.example/api/v1/admin/mcp/blocks?scope=central&actorId=${mocks.context.actor.userId}`;

function request(method: 'POST' | 'DELETE', body: unknown, origin = 'https://academy.example') {
  return new Request(endpoint, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAdminPermission.mockReset();
  mocks.getAdminContext.mockResolvedValue(mocks.context);
  mocks.profileFrom.mockReset().mockReturnValue(mocks.profileQuery);
  mocks.profileQuery.select.mockReset().mockReturnValue(mocks.profileQuery);
  mocks.profileQuery.eq.mockReset().mockReturnValue(mocks.profileQuery);
  mocks.profileQuery.maybeSingle.mockReset().mockResolvedValue({ data: { id: userId }, error: null });
  mocks.supabaseService.mockReturnValue({ from: mocks.profileFrom });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.getMcpAccessBlock.mockResolvedValue(null);
  mocks.blockMcpAccess.mockResolvedValue(block);
  mocks.unblockMcpAccess.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe('Central Admin MCP blocks API', () => {
  it('reads only a specified user block and states the OAuth grant remains valid', async () => {
    mocks.getMcpAccessBlock.mockResolvedValue(block);
    const response = await GET(new Request(`${endpoint}&userId=${userId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.assertAdminPermission).toHaveBeenCalledWith(mocks.context, 'user.manage.global');
    expect(mocks.profileFrom).toHaveBeenCalledWith('profiles');
    expect(mocks.profileQuery.eq).toHaveBeenCalledWith('id', userId);
    expect(mocks.getMcpAccessBlock).toHaveBeenCalledWith(userId, expect.anything());
    expect((await response.json()).data).toMatchObject({
      ...block, blocked: true, scope: 'all-mcp-clients', oauthGrantRevoked: false,
    });
  });

  it('returns USER_NOT_FOUND for a valid UUID without a profile', async () => {
    mocks.profileQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await GET(new Request(`${endpoint}&userId=${userId}`));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('USER_NOT_FOUND');
    expect(mocks.getMcpAccessBlock).not.toHaveBeenCalled();
  });

  it('fails closed when the target profile lookup errors', async () => {
    mocks.profileQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'private database details' } });
    const response = await GET(new Request(`${endpoint}&userId=${userId}`));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('MCP_ACCESS_UNAVAILABLE');
    expect(mocks.getMcpAccessBlock).not.toHaveBeenCalled();
  });

  it('rejects a branch management scope before reading any block', async () => {
    mocks.getAdminContext.mockResolvedValue({ ...mocks.context, scope: { kind: 'branch', branchId: 'ans' } });
    const response = await GET(new Request(`${endpoint}&userId=${userId}`));
    expect(response.status).toBe(403);
    expect(mocks.profileFrom).not.toHaveBeenCalled();
    expect(mocks.getMcpAccessBlock).not.toHaveBeenCalled();
  });

  it('rejects a central user without the live global management permission', async () => {
    mocks.assertAdminPermission.mockImplementation(() => {
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    });
    const response = await POST(request('POST', { userId }));
    expect(response.status).toBe(403);
    expect(mocks.blockMcpAccess).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects a missing Origin header before a mutation', async () => {
    const input = request('POST', { userId });
    input.headers.delete('origin');
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect(mocks.blockMcpAccess).not.toHaveBeenCalled();
  });

  it('rejects malformed UUIDs before a mutation', async () => {
    const response = await POST(request('POST', { userId: 'editor' }));
    expect(response.status).toBe(400);
    expect(mocks.blockMcpAccess).not.toHaveBeenCalled();
  });

  it('rate limits and blocks one user with a metadata-only audit entry', async () => {
    const response = await POST(request('POST', { userId, reason: ' Security review ' }));
    expect(response.status).toBe(200);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(expect.anything(), `mcp:admin-block:user:${mocks.context.actor.userId}`, expect.anything());
    expect(mocks.blockMcpAccess).toHaveBeenCalledWith(userId, 'Security review', mocks.context.actor.userId, expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.context.actor, 'mcp.access.block', { type: 'user', id: userId }, null, { blocked: true },
    );
    expect((await response.json()).data).toMatchObject({ blocked: true, oauthGrantRevoked: false });
  });

  it('audits a repeated block as replacing an existing block', async () => {
    mocks.getMcpAccessBlock.mockResolvedValue(block);
    const response = await POST(request('POST', { userId, reason: 'Reconfirmed' }));
    expect(response.status).toBe(200);
    expect(mocks.getMcpAccessBlock).toHaveBeenCalledWith(userId, expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.context.actor, 'mcp.access.block', { type: 'user', id: userId }, { blocked: true }, { blocked: true },
    );
  });

  it('does not write if the prior block status cannot be read', async () => {
    mocks.getMcpAccessBlock.mockRejectedValue(new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access status is unavailable'));
    const response = await POST(request('POST', { userId }));
    expect(response.status).toBe(503);
    expect(mocks.blockMcpAccess).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('does not unblock a user if the rate limit fails', async () => {
    mocks.enforceRateLimit.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests'));
    const response = await DELETE(request('DELETE', { userId }));
    expect(response.status).toBe(429);
    expect(mocks.unblockMcpAccess).not.toHaveBeenCalled();
  });

  it('does not audit a block that failed to commit', async () => {
    mocks.blockMcpAccess.mockRejectedValue(new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access update is unavailable'));
    const response = await POST(request('POST', { userId }));
    expect(response.status).toBe(503);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('unblocks only one user and audits the change', async () => {
    mocks.getMcpAccessBlock.mockResolvedValue(block);
    const response = await DELETE(request('DELETE', { userId }));
    expect(response.status).toBe(200);
    expect(mocks.unblockMcpAccess).toHaveBeenCalledWith(userId, expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.context.actor, 'mcp.access.unblock', { type: 'user', id: userId }, { blocked: true }, { blocked: false },
    );
    expect((await response.json()).data).toMatchObject({ userId, blocked: false, oauthGrantRevoked: false });
  });

  it('reports an audit failure without misreporting a committed block as failed', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    const response = await POST(request('POST', { userId }));
    expect(response.status).toBe(200);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'mcp.access.block', targetUserId: userId }));
  });
});

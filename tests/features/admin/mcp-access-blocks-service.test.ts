import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { blockMcpAccess, unblockMcpAccess } from '@/features/admin/mcp-access-blocks';

const userId = '22222222-2222-4222-8222-222222222222';
const actorId = '11111111-1111-4111-8111-111111111111';

function writeDatabase(result: { data: unknown; error: unknown }) {
  const query = {
    upsert: vi.fn(), select: vi.fn(), single: vi.fn(async () => result),
    delete: vi.fn(), eq: vi.fn(async () => result),
  };
  query.upsert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  const db = { from: vi.fn(() => query) };
  return { db, query };
}

describe('Central Admin MCP access block storage', () => {
  it('upserts a user-wide block and returns its stored metadata', async () => {
    const row = { user_id: userId, reason: 'Security review', blocked_by: actorId, blocked_at: '2026-09-26T00:00:00Z' };
    const { db, query } = writeDatabase({ data: row, error: null });
    await expect(blockMcpAccess(userId, 'Security review', actorId, db as never)).resolves.toEqual({
      userId, reason: 'Security review', blockedBy: actorId, blockedAt: row.blocked_at,
    });
    expect(db.from).toHaveBeenCalledWith('studio_mcp_access_blocks');
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: userId, reason: 'Security review', blocked_by: actorId }), { onConflict: 'user_id' });
  });

  it('fails closed if the block write errors', async () => {
    const { db } = writeDatabase({ data: null, error: { message: 'private database detail' } });
    await expect(blockMcpAccess(userId, null, actorId, db as never)).rejects.toMatchObject({ status: 503 });
  });

  it('reports a missing target account without exposing foreign-key details', async () => {
    const { db } = writeDatabase({ data: null, error: {
      code: '23503',
      message: 'insert or update on table "studio_mcp_access_blocks" violates foreign key constraint "studio_mcp_access_blocks_user_id_fkey"',
    } });
    await expect(blockMcpAccess(userId, null, actorId, db as never))
      .rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND', message: 'User not found' });
  });

  it('deletes only the selected user block', async () => {
    const { db, query } = writeDatabase({ data: null, error: null });
    await expect(unblockMcpAccess(userId, db as never)).resolves.toBeUndefined();
    expect(db.from).toHaveBeenCalledWith('studio_mcp_access_blocks');
    expect(query.eq).toHaveBeenCalledWith('user_id', userId);
  });

  it('fails closed if the unblock write errors', async () => {
    const { db } = writeDatabase({ data: null, error: { message: 'private database detail' } });
    await expect(unblockMcpAccess(userId, db as never)).rejects.toMatchObject({ status: 503 });
  });
});

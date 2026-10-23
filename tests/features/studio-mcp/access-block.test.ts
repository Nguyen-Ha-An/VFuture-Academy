import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isMcpAccessBlocked } from '@/features/studio-mcp/auth/access-block';

function blockDatabase(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then: vi.fn((resolve: (value: typeof result) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const database = { from: vi.fn(() => query) };
  return { database, query };
}

describe('per-user MCP access block lookup', () => {
  const userId = '51bda642-e203-42e2-9f6e-fb0b2f5c4c77';

  it('finds a block for the current user', async () => {
    const { database, query } = blockDatabase({ data: { user_id: userId }, error: null });
    await expect(isMcpAccessBlocked(userId, database as never)).resolves.toBe(true);
    expect(query.eq).toHaveBeenCalledWith('user_id', userId);
  });

  it('allows access only when the lookup confirms no block row', async () => {
    const { database } = blockDatabase({ data: null, error: null });
    await expect(isMcpAccessBlocked(userId, database as never)).resolves.toBe(false);
  });

  it('fails closed on a database error', async () => {
    const { database } = blockDatabase({ data: null, error: { code: 'XX000', message: 'private database details' } });
    await expect(isMcpAccessBlocked(userId, database as never))
      .rejects.toMatchObject({ code: 'MCP_ACCESS_UNAVAILABLE', status: 503, message: 'MCP access status is unavailable' });
  });

  it('fails closed when the database throws', async () => {
    const database = { from: vi.fn(() => { throw new Error('connection down'); }) };
    await expect(isMcpAccessBlocked(userId, database as never)).rejects.toThrow();
  });

  it('does not treat a malformed lookup response as no block', async () => {
    const { database } = blockDatabase({ data: undefined, error: null });
    await expect(isMcpAccessBlocked(userId, database as never)).rejects.toThrow();
  });

  it('checks again after a user is blocked', async () => {
    const clear = blockDatabase({ data: null, error: null });
    const blocked = blockDatabase({ data: { user_id: userId }, error: null });
    const database = { from: vi.fn()
      .mockReturnValueOnce(clear.query)
      .mockReturnValueOnce(blocked.query) };
    await expect(isMcpAccessBlocked(userId, database as never)).resolves.toBe(false);
    await expect(isMcpAccessBlocked(userId, database as never)).resolves.toBe(true);
    expect(database.from).toHaveBeenCalledTimes(2);
  });
});

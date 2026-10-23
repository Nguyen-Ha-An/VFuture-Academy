import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { memberStats, SUSPENDED_ACCOUNT_LIMIT } from '@/features/admin/member-stats';

type Op = [string, ...unknown[]];
type Query = { table: string; ops: Op[] };
type Result = { data?: unknown; count?: number | null; error: unknown };
type Handler = (query: Query) => Result;

/** A chainable, awaitable stand-in for the Supabase query builder that records every filter. */
function fakeDatabase(handler: Handler, rpcResult: Result = { data: { members: 40 }, error: null }) {
  const queries: Query[] = [];
  const rpc = vi.fn(async () => rpcResult);
  const from = (table: string) => {
    const query: Query = { table, ops: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'not', 'gt', 'in', 'range']) {
      builder[method] = (...args: unknown[]) => {
        query.ops.push([method, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
      try {
        return Promise.resolve(handler(query)).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    };
    return builder;
  };
  return { database: { from, rpc } as never, queries, rpc };
}

const has = (query: Query, ...op: unknown[]) => query.ops.some((entry) => JSON.stringify(entry) === JSON.stringify(op));

function context(kind: 'central' | 'branch', permissions: string[] = ['member.read', 'membership.manage']) {
  return {
    actor: { userId: 'operator', roles: [] },
    scope: kind === 'central' ? { kind: 'central' } : { kind: 'branch', branchId: 'ans' },
    permissions,
  } as never;
}

describe('member stats', () => {
  it('counts every card for the central scope with the directory filter definitions', async () => {
    const { database, queries, rpc } = fakeDatabase((query) => {
      if (query.table === 'profiles') return { count: 31, error: null };
      if (query.table === 'user_accounts') return { count: 3, error: null };
      if (query.table === 'admin_invitations') return { count: 5, error: null };
      throw new Error(`unexpected ${query.table}`);
    });

    await expect(memberStats(context('central'), database)).resolves.toEqual({ members: 40, learners: 31, suspended: 3, pendingInvitations: 5 });

    expect(rpc).toHaveBeenCalledWith('admin_management_read', expect.objectContaining({ p_operation: 'dashboard', p_scope_kind: 'central' }));
    const learners = queries.find((query) => query.table === 'profiles')!;
    expect(has(learners, 'not', 'branch_id', 'is', null)).toBe(true);
    const suspended = queries.find((query) => query.table === 'user_accounts')!;
    expect(has(suspended, 'eq', 'status', 'suspended')).toBe(true);
    const invites = queries.find((query) => query.table === 'admin_invitations')!;
    expect(has(invites, 'is', 'accepted_at', null)).toBe(true);
    expect(has(invites, 'is', 'revoked_at', null)).toBe(true);
    expect(invites.ops.some(([method, column]) => method === 'gt' && column === 'expires_at')).toBe(true);
    expect(invites.ops.some(([method, column]) => method === 'eq' && column === 'branch_id')).toBe(false);
  });

  it('scopes learners and pending invitations to the school in branch scope', async () => {
    const { database, queries } = fakeDatabase((query) => {
      if (query.table === 'profiles') return { count: 7, error: null };
      if (query.table === 'branch_memberships') return { count: 0, error: null };
      if (query.table === 'user_accounts') return { data: [], count: 0, error: null };
      if (query.table === 'admin_invitations') return { count: 1, error: null };
      throw new Error(`unexpected ${query.table}`);
    });

    const stats = await memberStats(context('branch'), database);

    expect(stats).toMatchObject({ learners: 7, suspended: 0, pendingInvitations: 1 });
    expect(has(queries.find((query) => query.table === 'profiles')!, 'eq', 'branch_id', 'ans')).toBe(true);
    expect(has(queries.find((query) => query.table === 'admin_invitations')!, 'eq', 'branch_id', 'ans')).toBe(true);
  });

  it('counts a branch suspension once, whether it comes from the membership or the whole account', async () => {
    // m1: membership suspended here · a1: account suspended, primary school here · a2: account suspended,
    // active membership here · a3: account suspended elsewhere · m1 is also account-suspended (no double count).
    const { database } = fakeDatabase((query) => {
      if (query.table === 'branch_memberships' && has(query, 'eq', 'status', 'suspended')) return { count: 1, error: null };
      if (query.table === 'user_accounts') return { data: [{ user_id: 'm1' }, { user_id: 'a1' }, { user_id: 'a2' }, { user_id: 'a3' }], count: 4, error: null };
      if (query.table === 'profiles' && query.ops.some(([method]) => method === 'in'))
        return { data: [{ id: 'm1', branch_id: 'other' }, { id: 'a1', branch_id: 'ans' }, { id: 'a2', branch_id: null }, { id: 'a3', branch_id: 'other' }], error: null };
      if (query.table === 'branch_memberships') return { data: [{ user_id: 'm1', status: 'suspended' }, { user_id: 'a2', status: 'active' }], error: null };
      if (query.table === 'profiles') return { count: 2, error: null };
      if (query.table === 'admin_invitations') return { count: 0, error: null };
      throw new Error(`unexpected ${query.table}`);
    });

    await expect(memberStats(context('branch'), database)).resolves.toMatchObject({ suspended: 3 });
  });

  it('says unavailable rather than undercounting when the suspended accounts do not fit one read', async () => {
    const { database } = fakeDatabase((query) => {
      if (query.table === 'branch_memberships') return { count: 0, error: null };
      if (query.table === 'user_accounts') return { data: [{ user_id: 'a1' }], count: SUSPENDED_ACCOUNT_LIMIT + 1, error: null };
      if (query.table === 'profiles' && query.ops.some(([method]) => method === 'in')) return { data: [{ id: 'a1', branch_id: 'ans' }], error: null };
      if (query.table === 'profiles') return { count: 2, error: null };
      if (query.table === 'admin_invitations') return { count: 0, error: null };
      throw new Error(`unexpected ${query.table}`);
    });

    const stats = await memberStats(context('branch'), database);
    expect(stats.suspended).toBeNull();
    expect(stats.learners).toBe(2);
  });

  it('turns each failed read into null (Unavailable), never 0, and keeps the other cards', async () => {
    const { database } = fakeDatabase((query) => {
      if (query.table === 'profiles') return { count: null, error: { message: 'boom' } };
      if (query.table === 'user_accounts') throw new Error('network');
      if (query.table === 'admin_invitations') return { count: 4, error: null };
      throw new Error(`unexpected ${query.table}`);
    }, { data: null, error: { code: 'XX000' } });

    await expect(memberStats(context('central'), database)).resolves.toEqual({ members: null, learners: null, suspended: null, pendingInvitations: 4 });
  });

  it('leaves out cards the viewer may not read so the page hides them', async () => {
    const { database, queries, rpc } = fakeDatabase(() => ({ count: 9, error: null }));

    await expect(memberStats(context('central', ['member.read']), database)).resolves.not.toHaveProperty('pendingInvitations');
    expect(queries.some((query) => query.table === 'admin_invitations')).toBe(false);

    const onlyInvites = await memberStats(context('central', ['membership.manage']), database);
    expect(onlyInvites).toEqual({ pendingInvitations: 9 });

    rpc.mockClear();
    await expect(memberStats(context('central', []), database)).resolves.toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });
});

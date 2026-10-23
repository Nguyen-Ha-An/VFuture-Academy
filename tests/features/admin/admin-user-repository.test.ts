import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));

import { createSupabaseAdminUserRepository } from '@/features/admin/users';

function queryResult(data: unknown[]) {
  const query = {
    select: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  for (const method of ['select', 'or', 'eq', 'in', 'order', 'range'] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

describe('Supabase admin user repository', () => {
  it('searches profile text with a bounded SQL range without scanning auth pages', async () => {
    const profiles = Array.from({ length: 51 }, (_, index) => ({
      id: `user-${index}`,
      handle: `learner-${index}`,
      display_name: `Learner ${index}`,
      branch_id: 'vinsmc',
    }));
    const profileQuery = queryResult(profiles);
    const roleQuery = queryResult([]);
    const listUsers = vi.fn();
    const rpc = vi.fn(async (name: string) => {
      if (name === 'admin_user_emails') {
        return { data: profiles.map((profile) => ({ id: profile.id, email: `${profile.id}@example.com` })), error: null };
      }
      return { data: null, error: null };
    });
    const client = {
      auth: { admin: { listUsers } },
      from: vi.fn((table: string) => table === 'profiles' ? profileQuery : roleQuery),
      rpc,
    } as unknown as SupabaseClient;

    const result = await createSupabaseAdminUserRepository(client).search({
      query: 'learner', branchId: 'vinsmc', page: 1, pageSize: 100,
    });

    expect(profileQuery.or).toHaveBeenCalledWith('handle.ilike.%learner%,display_name.ilike.%learner%');
    expect(profileQuery.range).toHaveBeenCalledWith(0, 50);
    expect(result.items).toHaveLength(50);
    expect(result).toMatchObject({ pageSize: 50, hasMore: true });
    expect(listUsers).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('resolves an exact email through one bounded SQL lookup and no auth-page scan', async () => {
    const roleQuery = queryResult([]);
    const listUsers = vi.fn();
    const rpc = vi.fn(async (name: string) => name === 'admin_find_user_by_email'
      ? {
          data: [{
            id: 'user-1', email: 'learner@example.com', handle: 'learner',
            display_name: 'Learner', branch_id: null,
          }],
          error: null,
        }
      : { data: null, error: null });
    const client = {
      auth: { admin: { listUsers } },
      from: vi.fn(() => roleQuery),
      rpc,
    } as unknown as SupabaseClient;

    const result = await createSupabaseAdminUserRepository(client).search({
      query: 'Learner@Example.com', branchId: 'vinsmc', includeUnassigned: true, page: 1, pageSize: 20,
    });

    expect(result.items).toEqual([expect.objectContaining({ id: 'user-1', email: 'learner@example.com' })]);
    expect(rpc).toHaveBeenCalledWith('admin_find_user_by_email', { p_email: 'learner@example.com' });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('uses the single atomic mutation RPC for branch and role changes', async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    const repository = createSupabaseAdminUserRepository(client);

    await repository.updateBranch('user-1', 'vinsmc', 'admin-1');
    await repository.setRole(
      'user-1',
      { role: 'instructor', branchId: 'vinsmc' },
      true,
      'admin-1',
    );

    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_apply_mutation', {
      p_operation: 'user.branch.assign',
      p_actor_id: 'admin-1',
      p_target_id: 'user-1',
      p_payload: { branchId: 'vinsmc' },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_apply_mutation', {
      p_operation: 'user.role.set',
      p_actor_id: 'admin-1',
      p_target_id: 'user-1',
      p_payload: { role: 'instructor', branchId: 'vinsmc', enabled: true },
    });
  });

  it('maps the database final-admin guard to a safe conflict response', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: 'P0001', message: 'cannot revoke final global admin' },
      })),
    } as unknown as SupabaseClient;
    const repository = createSupabaseAdminUserRepository(client);

    await expect(repository.setRole(
      'user-1',
      { role: 'admin', branchId: null },
      false,
      'admin-1',
    )).rejects.toMatchObject({ status: 409, code: 'LAST_ADMIN' });
  });
});

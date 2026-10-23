import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { schoolReports } from '@/features/admin/school-reports';

const central = { actor: { userId: 'operator' }, scope: { kind: 'central' } };
const branch = { actor: { userId: 'operator' }, scope: { kind: 'branch', branchId: 'ans' } };

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { rpc, client: { rpc } as never };
}

describe('school reports', () => {
  it('calls the reports operation in the current scope and maps each school row', async () => {
    const { rpc, client } = rpcClient({
      data: [
        { id: 'ans', name: 'An Sương', enrollments: 12, completedEnrollments: 4, submissions: 30, pendingGrading: 3, averagePercent: 81.25, activeLearners30d: 9 },
        { id: 'dewey', name: 'Dewey', enrollments: 0, completedEnrollments: 0, submissions: 0, pendingGrading: 0, averagePercent: null, activeLearners30d: 0 },
      ],
      error: null,
    });
    const rows = await schoolReports(branch as never, client);
    expect(rpc).toHaveBeenCalledWith('admin_management_read', {
      p_actor_id: 'operator', p_scope_kind: 'branch', p_branch_id: 'ans', p_operation: 'reports', p_input: {},
    });
    expect(rows).toEqual([
      { branchId: 'ans', name: 'An Sương', enrollments: 12, completedEnrollments: 4, submissions: 30, pendingGrading: 3, averagePercent: 81.25, activeLearners30d: 9 },
      { branchId: 'dewey', name: 'Dewey', enrollments: 0, completedEnrollments: 0, submissions: 0, pendingGrading: 0, averagePercent: null, activeLearners30d: 0 },
    ]);
  });

  it('accepts numeric strings from the numeric round() column', async () => {
    const { client } = rpcClient({
      data: [{ id: 'ans', name: 'An Sương', enrollments: 1, completedEnrollments: 1, submissions: 1, pendingGrading: 0, averagePercent: '66.67', activeLearners30d: 1 }],
      error: null,
    });
    const rows = await schoolReports(central as never, client);
    expect(rows?.[0].averagePercent).toBe(66.67);
  });

  it('returns an empty list, not undefined, when the scope has no schools', async () => {
    const { client } = rpcClient({ data: [], error: null });
    await expect(schoolReports(central as never, client)).resolves.toEqual([]);
  });

  it('returns undefined when the actor lacks the report permission', async () => {
    const { client } = rpcClient({ data: null, error: { code: '42501', message: 'Permission denied' } });
    await expect(schoolReports(central as never, client)).resolves.toBeUndefined();
  });

  it('throws on other failures so the page shows "Unavailable" instead of zeros', async () => {
    const failing = rpcClient({ data: null, error: { code: '42883', message: 'function missing' } });
    await expect(schoolReports(central as never, failing.client)).rejects.toThrow('Unable to complete');
    const malformed = rpcClient({ data: [{ id: 'ans', enrollments: 'many' }], error: null });
    await expect(schoolReports(central as never, malformed.client)).rejects.toThrow('Unable to load school reports');
    const notList = rpcClient({ data: { id: 'ans' }, error: null });
    await expect(schoolReports(central as never, notList.client)).rejects.toThrow('Unable to load school reports');
  });
});

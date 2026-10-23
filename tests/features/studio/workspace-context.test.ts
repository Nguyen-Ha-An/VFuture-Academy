import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  cookies: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ forbidden: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/auth', () => ({ loginDestination: vi.fn() }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/admin/branches', () => ({
  createSupabaseBranchRepository: vi.fn(() => ({ list: mocks.listBranches })),
}));

import { getWorkspaceContext } from '@/features/workspace/context';
import type { Actor } from '@/lib/permissions';

function liveActor(permission: 'grading.read' | 'content.review' | 'report.branch.read' | 'report.global.read', scope: 'central' | 'branch'): Actor {
  return {
    userId: 'operator', roles: [], authorization: {
      source: 'database', accountStatus: 'active',
      memberships: scope === 'branch' ? [{ branchId: 'school-a', status: 'active' }] : [],
      assignments: [{
        roleDefinitionId: 'custom',
        scope: scope === 'branch' ? { kind: 'branch', branchId: 'school-a' } : { kind: 'central' },
        permissions: [permission],
      }],
    },
  };
}

describe('neutral Studio workspace context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    mocks.listBranches.mockResolvedValue([
      { id: 'school-a', name: 'School A' },
      { id: 'school-b', name: 'School B' },
    ]);
  });

  it.each([
    ['grading.read', 'branch'],
    ['content.review', 'central'],
    ['report.branch.read', 'branch'],
  ] as const)('builds authorized scopes from %s without admin.access', async (permission, scope) => {
    mocks.getActor.mockResolvedValue(liveActor(permission, scope));

    const context = await getWorkspaceContext();

    expect(context.options.map((option) => option.scope)).toEqual(
      scope === 'central' ? [{ kind: 'central' }] : [{ kind: 'branch', branchId: 'school-a' }],
    );
    expect(context.permissions).toContain(permission);
  });

  it('does not expose an unauthorized branch', async () => {
    mocks.getActor.mockResolvedValue(liveActor('grading.read', 'branch'));
    const context = await getWorkspaceContext();
    expect(context.branches.map((branch) => branch.id)).toEqual(['school-a']);
  });
  it('allows Central reports to name all schools without inventing branch workspaces',async()=>{
    mocks.getActor.mockResolvedValue(liveActor('report.global.read','central'));
    const context=await getWorkspaceContext();
    expect(context.branches.map(b=>b.id)).toEqual(['school-a','school-b']);
    expect(context.options.map(o=>o.scope)).toEqual([{kind:'central'}]);
  });

});

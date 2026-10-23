import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  cookie: undefined as string | undefined,
  listBranches: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.cookie === undefined ? undefined : { value: mocks.cookie } }) }));
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

import { getGradingContext, getStudioContext } from '@/features/workspace/context';
import { ApiError } from '@/lib/api';
import type { Actor, Permission, Scope } from '@/lib/permissions';
import { workspaceNavigationFor } from '@/lib/workspace-navigation';

function actor(grants: Array<{ permissions: Permission[]; scope: Scope }>): Actor {
  const branchIds = [...new Set(grants.flatMap(({ scope }) => scope.kind === 'branch' ? [scope.branchId] : []))];
  return {
    userId: 'operator', roles: [],
    authorization: {
      source: 'database', accountStatus: 'active',
      memberships: branchIds.map((branchId) => ({ branchId, status: 'active' as const })),
      assignments: grants.map(({ permissions, scope }, index) => ({ roleDefinitionId: `role-${index}`, scope, permissions })),
    },
  };
}

const central: Scope = { kind: 'central' };
const schoolA: Scope = { kind: 'branch', branchId: 'school-a' };
const schoolB: Scope = { kind: 'branch', branchId: 'school-b' };

/** Grading in one school and reports in another: the classic split-scope operator. */
const splitOperator = () => actor([
  { permissions: ['submission.grade'], scope: schoolA },
  { permissions: ['report.branch.read'], scope: schoolB },
]);

describe('Assessment & grading workspace context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie = undefined;
    mocks.listBranches.mockResolvedValue([
      { id: 'school-a', name: 'School A' },
      { id: 'school-b', name: 'School B' },
    ]);
  });

  it('admits a grader without admin.access and lands on the queue', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['submission.grade'], scope: schoolA }]));

    const context = await getGradingContext();

    expect(context.workspace).toBe('grading');
    expect(context.permissions).toContain('submission.grade');
    expect(context.permissions).not.toContain('admin.access');
    expect(context.options.map((option) => option.scope)).toEqual([schoolA]);
    expect(workspaceNavigationFor('grading', context.permissions).map((item) => item.href))
      .toEqual(['/grading', '/grading/assessments', '/grading/queue']);
    expect(context.entries).toEqual({ studio: null, grading: '/grading', admin: null });
  });

  it('admits a report-only operator without admin.access and shows only reports', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['report.branch.read'], scope: schoolA }]));

    const context = await getGradingContext();

    expect(context.permissions).toEqual(['report.branch.read']);
    expect(workspaceNavigationFor('grading', context.permissions).map((item) => item.href))
      .toEqual(['/grading', '/grading/reports']);
  });

  it('honours a stored scope preference and offers only that scope its own destinations', async () => {
    mocks.getActor.mockResolvedValue(splitOperator());
    mocks.cookie = 'branch:school-b';

    const context = await getGradingContext();

    expect(context.scope).toEqual(schoolB);
    expect(context.permissions).toEqual(['report.branch.read']);
    const reachable = workspaceNavigationFor('grading', context.permissions).map((item) => item.href);
    expect(reachable).toEqual(['/grading', '/grading/reports']);
    expect(reachable).not.toContain('/grading/queue');
  });

  it('reaches the grading queue in the other school when the preference changes', async () => {
    mocks.getActor.mockResolvedValue(splitOperator());
    mocks.cookie = 'branch:school-a';

    const context = await getGradingContext();

    expect(context.scope).toEqual(schoolA);
    expect(workspaceNavigationFor('grading', context.permissions).map((item) => item.href))
      .toEqual(['/grading', '/grading/assessments', '/grading/queue']);
  });

  it('offers the workspace landing, never a destination the active scope cannot reach', async () => {
    mocks.getActor.mockResolvedValue(splitOperator());

    for (const cookie of [undefined, 'branch:school-a', 'branch:school-b', 'branch:unknown-school']) {
      mocks.cookie = cookie;
      const context = await getGradingContext();
      const reachable = workspaceNavigationFor('grading', context.permissions).map((item) => item.href);

      expect(context.entries.grading).toBe('/grading');
      expect(reachable.length).toBeGreaterThan(0);
      expect(context.options.map((option) => option.scope)).toEqual([schoolA, schoolB]);
    }
  });

  it('falls back to an authorized scope when the stored preference is no longer available', async () => {
    mocks.getActor.mockResolvedValue(splitOperator());
    mocks.cookie = 'branch:closed-school';

    const context = await getGradingContext();

    expect(context.options.map((option) => option.scope)).toContainEqual(context.scope);
    expect(workspaceNavigationFor('grading', context.permissions).length).toBeGreaterThan(0);
  });

  it('keeps a central grader working at Central scope', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['submission.grade', 'exam.release'], scope: central }]));

    const context = await getGradingContext();

    expect(context.scope).toEqual(central);
    expect(context.options.map((option) => option.scope)).toEqual([central]);
  });

  it('names every school for a global report reader without inventing branch workspaces', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['report.global.read'], scope: central }]));

    const context = await getGradingContext();

    expect(context.branches.map((branch) => branch.id)).toEqual(['school-a', 'school-b']);
    expect(context.options.map((option) => option.scope)).toEqual([central]);
  });

  it('never leaks a school the actor does not operate', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['submission.grade'], scope: schoolA }]));

    const context = await getGradingContext();

    expect(context.branches.map((branch) => branch.id)).toEqual(['school-a']);
  });
});

describe('workspace admission is separated per workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie = undefined;
    mocks.listBranches.mockResolvedValue([{ id: 'school-a', name: 'School A' }]);
  });

  it('denies Studio to a grading-only operator', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['submission.grade', 'exam.release'], scope: schoolA }]));

    await expect(getStudioContext()).rejects.toMatchObject({ status: 403 });
  });

  it('denies Assessment & grading to a content-only editor', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['content.read', 'course.edit'], scope: central }]));

    await expect(getGradingContext()).rejects.toMatchObject({ status: 403 });
    await expect(getStudioContext()).resolves.toMatchObject({ workspace: 'studio' });
  });

  it('denies both workspaces to a permission that reaches no page', async () => {
    mocks.getActor.mockResolvedValue(actor([{ permissions: ['learning.read'], scope: schoolA }]));

    await expect(getGradingContext()).rejects.toBeInstanceOf(ApiError);
    await expect(getStudioContext()).rejects.toBeInstanceOf(ApiError);
  });

  it('requires authentication before resolving any workspace', async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(getGradingContext()).rejects.toMatchObject({ status: 401 });
  });

  it('denies a suspended account and a suspended membership', async () => {
    const grader = actor([{ permissions: ['submission.grade'], scope: schoolA }]);
    mocks.getActor.mockResolvedValue({
      ...grader,
      authorization: { ...grader.authorization!, accountStatus: 'suspended' },
    });
    await expect(getGradingContext()).rejects.toMatchObject({ status: 403 });

    mocks.getActor.mockResolvedValue({
      ...grader,
      authorization: { ...grader.authorization!, memberships: [{ branchId: 'school-a', status: 'suspended' }] },
    });
    await expect(getGradingContext()).rejects.toMatchObject({ status: 403 });
  });
});

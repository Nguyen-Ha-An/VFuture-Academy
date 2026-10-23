import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  serviceRpc: vi.fn(),
  supabaseUser: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: mocks.supabaseUser,
  supabaseService: mocks.supabaseService,
}));

import {
  BUILT_IN_ROLE_PERMISSIONS,
  BRANCH_SCOPED_PERMISSIONS,
  getActor,
  hasAnyStudioPermission,
  hasPermission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  requirePermission,
  ROLE_PERMISSIONS,
  STUDIO_WORKSPACE_PERMISSIONS,
  studioPermissions,
  type Actor,
  type Permission,
  type Role,
} from '@/lib/permissions';

function actor(roles: Actor['roles']): Actor {
  return { userId: 'user-1', roles };
}

const unsafeHasPermission = hasPermission as (
  candidate: Actor,
  permission: Permission,
  scope?: { branchId?: string | null },
) => boolean;

describe('permission contract', () => {
  it('exposes grouped administration permissions and preserves legacy names', () => {
    expect(PERMISSION_GROUPS).toMatchObject({
      admin: ['admin.access'],
      members: ['member.read', 'member.manage', 'membership.manage'],
      roles: ['role.definition.read', 'role.definition.manage', 'role.assignment.global', 'role.assignment.branch'],
      branches: ['branch.read', 'branch.manage'],
      content: ['content.read', 'content.create', 'content.edit', 'content.review.request', 'content.review', 'content.publish'],
      grading: ['learning.read', 'grading.read', 'grading.manage', 'submission.grade', 'exam.release'],
      reporting: ['report.branch.read', 'report.global.read'],
      audit: ['audit.read'],
    });
    expect(PERMISSIONS).toEqual(expect.arrayContaining([
      'course.read', 'course.create', 'course.edit', 'course.publish', 'course.delete',
      'bank.edit', 'bank.publish', 'media.upload', 'resource.edit', 'resource.publish',
      'opportunity.edit', 'opportunity.publish', 'project.edit', 'user.manage.branch',
      'user.manage.global', 'analytics.branch.read', 'analytics.global.read',
    ]));
    expect(ROLE_PERMISSIONS).toEqual({
      contributor: ['resource.edit'],
      editor: ['course.read', 'course.create', 'course.edit', 'bank.edit', 'bank.publish', 'media.upload', 'resource.edit', 'resource.publish', 'opportunity.edit', 'opportunity.publish', 'project.edit'],
      instructor: ['course.read', 'submission.grade', 'exam.release', 'analytics.branch.read'],
      branch_lead: ['course.read', 'submission.grade', 'exam.release', 'analytics.branch.read', 'user.manage.branch', 'opportunity.edit'],
      admin: [...PERMISSIONS],
    } satisfies Record<Role, readonly string[]>);
    expect(BUILT_IN_ROLE_PERMISSIONS.central_reviewer).toContain('content.publish');
    expect(BUILT_IN_ROLE_PERMISSIONS.central_editor).not.toContain('content.publish');
    expect(BUILT_IN_ROLE_PERMISSIONS.school_editor).not.toContain('content.review');
    expect(BUILT_IN_ROLE_PERMISSIONS.member).toEqual([]);
  });
});

describe('hasPermission', () => {
  it('allows an instructor to grade only inside their assigned branch', () => {
    const instructor = actor([{ role: 'instructor', branchId: 'vinsmc' }]);

    expect(hasPermission(instructor, 'submission.grade', { branchId: 'vinsmc' })).toBe(true);
    expect(hasPermission(instructor, 'submission.grade', { branchId: 'ans' })).toBe(false);
  });

  it('allows a global admin everywhere but never grants a learner or unmapped permission', () => {
    expect(hasPermission(actor([{ role: 'admin', branchId: null }]), 'course.delete', { branchId: 'ans' })).toBe(true);
    expect(hasPermission(actor([]), 'course.read', { branchId: 'vinsmc' })).toBe(false);
    expect(hasPermission(actor([{ role: 'contributor', branchId: null }]), 'course.publish', { branchId: 'vinsmc' })).toBe(false);
  });

  it('allows global role rows at every scope and considers mixed global and scoped roles', () => {
    const mixed = actor([
      { role: 'contributor', branchId: null },
      { role: 'instructor', branchId: 'vinsmc' },
    ]);

    expect(hasPermission(mixed, 'resource.edit', { branchId: 'ans' })).toBe(true);
    expect(hasPermission(mixed, 'submission.grade', { branchId: 'vinsmc' })).toBe(true);
    expect(hasPermission(mixed, 'submission.grade', { branchId: 'ans' })).toBe(false);
  });

  it('denies branch-scoped roles when scope is null or missing', () => {
    const instructor = actor([{ role: 'instructor', branchId: 'vinsmc' }]);

    expect(unsafeHasPermission(instructor, 'submission.grade')).toBe(false);
    expect(unsafeHasPermission(instructor, 'submission.grade', {})).toBe(false);
    expect(unsafeHasPermission(instructor, 'submission.grade', { branchId: null })).toBe(false);
  });

  it('requires a concrete scope for branch permissions even when the role row is global', () => {
    const admin = actor([{ role: 'admin', branchId: null }]);

    // @ts-expect-error Branch-scoped permissions must always carry a branch scope.
    expect(hasPermission(admin, 'submission.grade')).toBe(false);
  });

  it('never grants content permissions from a branch-scoped role row', () => {
    expect(hasPermission(
      actor([{ role: 'instructor', branchId: 'vinsmc' }]),
      'course.read',
      { branchId: 'vinsmc' },
    )).toBe(false);
    expect(hasPermission(
      actor([{ role: 'editor', branchId: 'vinsmc' }]),
      'bank.edit',
      { branchId: 'vinsmc' },
    )).toBe(false);
    expect(hasPermission(
      actor([{ role: 'branch_lead', branchId: 'vinsmc' }]),
      'opportunity.edit',
      { branchId: 'vinsmc' },
    )).toBe(false);
  });
});

describe('hasAnyStudioPermission', () => {
  it.each([
    ['global contributor', [{ role: 'contributor', branchId: null }], ['resource.edit']],
    ['branch contributor', [{ role: 'contributor', branchId: 'vinsmc' }], []],
    ['branch instructor', [{ role: 'instructor', branchId: 'vinsmc' }], [
      'learning.read', 'grading.read', 'grading.manage', 'submission.grade',
      'exam.release', 'report.branch.read', 'analytics.branch.read',
    ]],
    ['global admin', [{ role: 'admin', branchId: null }],
      PERMISSIONS.filter((permission) => STUDIO_WORKSPACE_PERMISSIONS.includes(permission as never)
        && !BRANCH_SCOPED_PERMISSIONS.includes(permission as never))],
  ] as const)('derives effective Studio permissions for %s', (_label, roles, expected) => {
    const value = actor(roles.map((role) => ({ ...role })));
    expect(studioPermissions(value)).toEqual(expected);
    expect(hasAnyStudioPermission(value)).toBe(expected.length > 0);
  });
});

describe('getActor and requirePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseUser.mockResolvedValue({ auth: { getUser: mocks.authGetUser } });
    mocks.supabaseService.mockReturnValue({ rpc: mocks.serviceRpc });
    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null });
    mocks.serviceRpc.mockResolvedValue({
      data: {
        accountStatus: 'active',
        memberships: [{ branchId: 'vinsmc', status: 'active' }],
        assignments: [{
          roleDefinitionId: 'teacher',
          scope: { kind: 'branch', branchId: 'vinsmc' },
          permissions: ['admin.access', 'submission.grade'],
        }],
      },
      error: null,
    });
  });

  it('derives the actor ID from the authenticated cookie and live authorization from one service RPC', async () => {
    await expect(getActor()).resolves.toEqual({
      userId: 'auth-user-1',
      roles: [],
      authorization: {
        source: 'database',
        accountStatus: 'active',
        memberships: [{ branchId: 'vinsmc', status: 'active' }],
        assignments: [{
          roleDefinitionId: 'teacher',
          scope: { kind: 'branch', branchId: 'vinsmc' },
          permissions: ['admin.access', 'submission.grade'],
        }],
      },
    });
    expect(mocks.serviceRpc).toHaveBeenCalledWith('authorization_actor', { p_user_id: 'auth-user-1' });
  });

  it('returns null for an unauthenticated request', async () => {
    mocks.authGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getActor()).resolves.toBeNull();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });

  it('treats Supabase AuthSessionMissingError as an anonymous request', async () => {
    mocks.authGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await expect(getActor()).resolves.toBeNull();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });

  it('fails closed on malformed authorization instead of silently returning fewer roles', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: { accountStatus: 'active', memberships: [], assignments: [{ permissions: ['root.everything'] }] },
      error: null,
    });

    await expect(getActor()).rejects.toThrow('Unable to load authorization');
  });

  it('propagates generic authentication and role-loading failures without secret details', async () => {
    mocks.authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'token=private-value' } });
    await expect(getActor()).rejects.toThrow('Unable to authenticate user');

    mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null });
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { message: 'service_role_key=private-value' } });
    await expect(getActor()).rejects.toThrow('Unable to load authorization');
  });

  it('throws a 403 ApiError when no authenticated actor has the required permission', async () => {
    await expect(requirePermission('submission.grade', { branchId: 'ans' })).rejects.toMatchObject({
      status: 403, code: 'FORBIDDEN', message: 'Permission denied',
    });
  });

  it('throws a 401 ApiError when no authenticated actor exists', async () => {
    mocks.authGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requirePermission('course.read')).rejects.toMatchObject({
      status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required',
    });
  });

  it('rejects branch-scoped permission calls that omit a concrete scope before authentication', async () => {
    // @ts-expect-error Branch-scoped permissions must always carry a branch scope.
    await expect(requirePermission('submission.grade')).rejects.toThrow(
      'Branch-scoped permission "submission.grade" requires a branchId scope',
    );
    expect(mocks.authGetUser).not.toHaveBeenCalled();
  });

  it('returns the authorized actor from requirePermission', async () => {
    await expect(requirePermission('submission.grade', { branchId: 'vinsmc' })).resolves.toMatchObject({
      userId: 'auth-user-1', roles: [], authorization: { accountStatus: 'active' },
    });
  });
});

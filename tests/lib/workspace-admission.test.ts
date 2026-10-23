import { describe, expect, it } from 'vitest';

import type { Actor, Permission, Scope } from '@/lib/authorization';
import { canEnter, workspaceEntries, actorScopes } from '@/lib/workspace-admission';
import { canEnterWorkspace, firstWorkspaceDestination, workspaceEntriesFor } from '@/lib/workspace-navigation';
import { STAFF_WORKSPACES, WORKSPACE_PERMISSIONS, workspaceForPathname, workspaceHome } from '@/lib/workspaces';

type Grant = { permissions: Permission[]; scope: Scope };

function actor(grants: Grant[]): Actor {
  const branchIds = [...new Set(grants.flatMap(({ scope }) => scope.kind === 'branch' ? [scope.branchId] : []))];
  return {
    userId: 'operator',
    roles: [],
    authorization: {
      source: 'database',
      accountStatus: 'active',
      memberships: branchIds.map((branchId) => ({ branchId, status: 'active' as const })),
      assignments: grants.map(({ permissions, scope }, index) => ({
        roleDefinitionId: `role-${index}`,
        scope,
        permissions,
      })),
    },
  };
}

const central: Scope = { kind: 'central' };
const branchA: Scope = { kind: 'branch', branchId: 'school-a' };
const branchB: Scope = { kind: 'branch', branchId: 'school-b' };

describe('staff workspace admission', () => {
  it('gives a content-only editor Studio and nothing else', () => {
    const editor = actor([{ permissions: ['content.read', 'content.edit', 'course.read', 'bank.edit'], scope: central }]);

    expect(workspaceEntries(editor)).toEqual({ studio: '/studio', grading: null, admin: null });
    expect(canEnter(editor, 'studio')).toBe(true);
    expect(canEnter(editor, 'grading')).toBe(false);
    expect(canEnter(editor, 'admin')).toBe(false);
  });

  it('gives a grader-only teacher the grading queue without admin.access', () => {
    const grader = actor([{ permissions: ['submission.grade', 'grading.read', 'learning.read'], scope: branchA }]);

    expect(workspaceEntries(grader)).toEqual({ studio: null, grading: '/grading', admin: null });
    expect(canEnter(grader, 'grading')).toBe(true);
  });

  it('gives a report-only operator learning reports without admin.access', () => {
    const analyst = actor([{ permissions: ['report.branch.read'], scope: branchA }]);

    expect(workspaceEntries(analyst)).toEqual({ studio: null, grading: '/grading', admin: null });
    expect(canEnter(analyst, 'admin')).toBe(false);
  });

  it('honours the retained legacy analytics permission for report entry', () => {
    const legacyAnalyst = actor([{ permissions: ['analytics.branch.read'], scope: branchA }]);

    expect(workspaceEntries(legacyAnalyst).grading).toBe('/grading');
  });

  it('gives an admin-only operator Administration only', () => {
    const admin = actor([{ permissions: ['admin.access', 'member.read', 'audit.read'], scope: branchA }]);

    expect(workspaceEntries(admin)).toEqual({ studio: null, grading: null, admin: '/admin' });
  });

  it('admits a course.publish publisher to Administration without general admin authority', () => {
    const publisher = actor([{ permissions: ['course.publish', 'content.publish'], scope: central }]);

    expect(workspaceEntries(publisher)).toEqual({ studio: '/studio', grading: null, admin: '/admin' });
    expect(firstWorkspaceDestination('admin', ['course.publish'])).toBe('/admin/enrollment-migration');
    expect(firstWorkspaceDestination('admin', ['admin.access'])).toBe('/admin');
    expect(firstWorkspaceDestination('admin', ['audit.read'])).toBe('/admin/audit');
  });

  it('offers only a landing page, never a destination another scope cannot reach', () => {
    const split = actor([
      { permissions: ['submission.grade'], scope: branchA },
      { permissions: ['report.branch.read'], scope: branchB },
    ]);

    expect(workspaceEntries(split).grading).toBe('/grading');
    expect(Object.values(workspaceEntries(split)).filter(Boolean))
      .toEqual(expect.not.arrayContaining(['/grading/queue', '/grading/reports']));
  });

  it('resolves every workspace for a multi-branch operator with mixed roles', () => {
    const mixed = actor([
      { permissions: ['content.read', 'course.read'], scope: central },
      { permissions: ['submission.grade'], scope: branchA },
      { permissions: ['admin.access', 'member.read'], scope: branchB },
    ]);

    expect(workspaceEntries(mixed)).toEqual({
      studio: '/studio',
      grading: '/grading',
      admin: '/admin',
    });
    expect(actorScopes(mixed)).toEqual([central, branchA, branchB]);
  });

  it('does not admit a workspace on a permission that reaches no page', () => {
    const stranded = actor([{ permissions: ['learning.read'], scope: branchA }]);

    expect(canEnter(stranded, 'grading')).toBe(false);
    expect(workspaceEntries(stranded)).toEqual({ studio: null, grading: null, admin: null });
  });

  it('ignores authority from a suspended membership or account', () => {
    const grader = actor([{ permissions: ['submission.grade'], scope: branchA }]);
    const suspendedMembership: Actor = {
      ...grader,
      authorization: { ...grader.authorization!, memberships: [{ branchId: 'school-a', status: 'suspended' }] },
    };
    const suspendedAccount: Actor = {
      ...grader,
      authorization: { ...grader.authorization!, accountStatus: 'suspended' },
    };

    expect(workspaceEntries(suspendedMembership).grading).toBeNull();
    expect(workspaceEntries(suspendedAccount).grading).toBeNull();
  });

  it('keeps a legacy role tuple actor working without a resolved authorization', () => {
    const legacyInstructor: Actor = { userId: 'legacy', roles: [{ role: 'instructor', branchId: 'school-a' }] };
    const legacyEditor: Actor = { userId: 'legacy-editor', roles: [{ role: 'editor', branchId: null }] };

    expect(workspaceEntries(legacyInstructor).grading).toBe('/grading');
    expect(workspaceEntries(legacyInstructor).studio).toBeNull();
    expect(workspaceEntries(legacyEditor).studio).toBe('/studio');
    expect(workspaceEntries(legacyEditor).grading).toBeNull();
  });
});

describe('workspace registry integrity', () => {
  it('never lets one permission open two workspaces except publication', () => {
    const shared = STAFF_WORKSPACES.flatMap((workspace) =>
      WORKSPACE_PERMISSIONS[workspace].map((permission) => `${permission}` as Permission));
    const duplicates = [...new Set(shared.filter((permission, index) => shared.indexOf(permission) !== index))];

    expect(duplicates).toEqual(['course.publish']);
  });

  it('maps canonical pathnames back to their workspace', () => {
    expect(workspaceForPathname('/studio')).toBe('studio');
    expect(workspaceForPathname('/studio/courses/ai')).toBe('studio');
    expect(workspaceForPathname('/grading')).toBe('grading');
    expect(workspaceForPathname('/grading/assignments/s-1')).toBe('grading');
    expect(workspaceForPathname('/admin/audit')).toBe('admin');
    expect(workspaceForPathname('/app/courses')).toBeNull();
    expect(workspaceForPathname('/gradingx')).toBeNull();
    expect(STAFF_WORKSPACES.map(workspaceHome)).toEqual(['/studio', '/grading', '/admin']);
  });

  it('derives entries from the permissions given, not from a workspace filter', () => {
    const permissions: Permission[] = ['course.read', 'submission.grade', 'admin.access'];

    expect(workspaceEntriesFor(permissions)).toEqual({
      studio: '/studio',
      grading: '/grading',
      admin: '/admin',
    });
    for (const workspace of STAFF_WORKSPACES) {
      expect(canEnterWorkspace(workspace, permissions)).toBe(true);
      expect(firstWorkspaceDestination(workspace, permissions)).not.toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLE_PERMISSIONS, can, type Actor } from '@/lib/authorization';

describe('teaching capabilities', () => {
  it('grants teachers school scoped authoring without granting school admins', () => {
    const actor: Actor = { userId: 'u', roles: [], authorization: { source: 'database', accountStatus: 'active', memberships: [{ branchId: 'school-a', status: 'active' }], assignments: [{ roleDefinitionId: 'teacher', scope: { kind: 'branch', branchId: 'school-a' }, permissions: [...BUILT_IN_ROLE_PERMISSIONS.teacher] }] } };
    expect(can(actor, 'teaching.announcement.manage', { kind: 'branch', branchId: 'school-a' })).toBe(true);
    expect(can(actor, 'teaching.schedule.manage', { kind: 'branch', branchId: 'school-b' })).toBe(false);
    expect(BUILT_IN_ROLE_PERMISSIONS.school_admin).not.toContain('teaching.announcement.manage');
    expect(BUILT_IN_ROLE_PERMISSIONS.school_admin).not.toContain('teaching.schedule.manage');
  });
});

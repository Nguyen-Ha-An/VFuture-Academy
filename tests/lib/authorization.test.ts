import { describe, expect, it } from 'vitest';

import {
  allowedBranchIds,
  can,
  canAccessAdmin,
  canAccessStudio,
  effectivePermissions,
  hasGlobalPermission,
  type Actor,
  type ResolvedAuthorization,
  type Scope,
} from '@/lib/authorization';

function liveActor(authorization: Omit<ResolvedAuthorization, 'source'>): Actor {
  return {
    userId: 'actor-1',
    roles: [],
    authorization: { source: 'database', ...authorization },
  };
}

const central: Scope = { kind: 'central' };
const vinsmc: Scope = { kind: 'branch', branchId: 'vinsmc' };
const ans: Scope = { kind: 'branch', branchId: 'ans' };

describe('live authorization resolver', () => {
  it('applies a central assignment globally and a branch assignment only at its active membership', () => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: [
        { branchId: 'vinsmc', status: 'active' },
        { branchId: 'ans', status: 'suspended' },
      ],
      assignments: [
        {
          roleDefinitionId: 'central-editor',
          scope: central,
          permissions: ['content.read', 'content.edit'],
        },
        {
          roleDefinitionId: 'teacher',
          scope: vinsmc,
          permissions: ['submission.grade', 'report.branch.read'],
        },
        {
          roleDefinitionId: 'teacher',
          scope: ans,
          permissions: ['submission.grade'],
        },
      ],
    });

    expect(can(actor, 'content.edit', central)).toBe(true);
    expect(can(actor, 'content.edit', vinsmc)).toBe(true);
    expect(can(actor, 'submission.grade', vinsmc)).toBe(true);
    expect(can(actor, 'submission.grade', ans)).toBe(false);
    expect(can(actor, 'submission.grade', central)).toBe(false);
  });

  it('denies every permission while the global account is suspended', () => {
    const actor = liveActor({
      accountStatus: 'suspended',
      memberships: [{ branchId: 'vinsmc', status: 'active' }],
      assignments: [{
        roleDefinitionId: 'central-admin',
        scope: central,
        permissions: ['admin.access', 'submission.grade', 'content.publish'],
      }],
    });

    expect(effectivePermissions(actor, central)).toEqual([]);
    expect(effectivePermissions(actor, vinsmc)).toEqual([]);
    expect(canAccessAdmin(actor)).toBe(false);
    expect(canAccessStudio(actor)).toBe(false);
  });

  it('never accepts central-only review or publish from a malicious branch assignment', () => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: [{ branchId: 'vinsmc', status: 'active' }],
      assignments: [{
        roleDefinitionId: 'malicious-custom-role',
        scope: vinsmc,
        permissions: ['content.read', 'content.review', 'content.publish'],
      }],
    });

    expect(can(actor, 'content.read', vinsmc)).toBe(true);
    expect(can(actor, 'content.review', vinsmc)).toBe(false);
    expect(can(actor, 'content.publish', vinsmc)).toBe(false);
  });

  it('reports global authority separately from concrete allowed membership branches', () => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: [
        { branchId: 'vinsmc', status: 'active' },
        { branchId: 'ans', status: 'suspended' },
      ],
      assignments: [
        { roleDefinitionId: 'central-admin', scope: central, permissions: ['submission.grade'] },
        { roleDefinitionId: 'teacher', scope: vinsmc, permissions: ['submission.grade'] },
        { roleDefinitionId: 'teacher', scope: ans, permissions: ['submission.grade'] },
      ],
    });

    expect(hasGlobalPermission(actor, 'submission.grade')).toBe(true);
    expect(allowedBranchIds(actor, 'submission.grade')).toEqual(['vinsmc']);
  });

  it('opens Studio operations but not Admin for teaching-only assignments', () => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: [{ branchId: 'vinsmc', status: 'active' }],
      assignments: [{
        roleDefinitionId: 'teacher',
        scope: vinsmc,
        permissions: ['learning.read', 'submission.grade', 'exam.release'],
      }],
    });

    expect(canAccessAdmin(actor)).toBe(false);
    expect(canAccessStudio(actor)).toBe(true);
  });

  it.each([
    ['grading-only', 'grading.read', vinsmc],
    ['review-only', 'content.review', central],
    ['report-only', 'report.branch.read', vinsmc],
  ] as const)('opens Studio for a %s custom role', (_label, permission, scope) => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: scope.kind === 'branch'
        ? [{ branchId: scope.branchId, status: 'active' }]
        : [],
      assignments: [{ roleDefinitionId: _label, scope, permissions: [permission] }],
    });

    expect(canAccessStudio(actor)).toBe(true);
    expect(canAccessAdmin(actor)).toBe(false);
  });

  it('fails closed on unknown permission values in database-shaped actor input', () => {
    const actor = liveActor({
      accountStatus: 'active',
      memberships: [],
      assignments: [{
        roleDefinitionId: 'bad-row',
        scope: central,
        permissions: ['admin.access', 'root.everything'] as never,
      }],
    });

    expect(effectivePermissions(actor, central)).toEqual(['admin.access']);
  });
});

describe('legacy fixture compatibility', () => {
  it('preserves old role tuples while requiring an explicit scope', () => {
    const actor: Actor = {
      userId: 'fixture-admin',
      roles: [{ role: 'admin', branchId: null }],
    };

    expect(can(actor, 'course.publish', central)).toBe(true);
    expect(can(actor, 'submission.grade', vinsmc)).toBe(true);
    expect(can(actor, 'submission.grade', ans)).toBe(true);
  });

  it('keeps branch legacy content grants ineffective', () => {
    const actor: Actor = {
      userId: 'fixture-editor',
      roles: [{ role: 'editor', branchId: 'vinsmc' }],
    };

    expect(can(actor, 'bank.edit', vinsmc)).toBe(false);
    expect(canAccessStudio(actor)).toBe(false);
  });

  it('keeps a branch instructor in Studio grading without opening Admin', () => {
    const actor: Actor = {
      userId: 'fixture-instructor',
      roles: [{ role: 'instructor', branchId: 'vinsmc' }],
    };

    expect(canAccessAdmin(actor)).toBe(true);
    expect(canAccessStudio(actor)).toBe(true);
    expect(can(actor, 'grading.read', vinsmc)).toBe(true);
    expect(can(actor, 'grading.manage', vinsmc)).toBe(true);
    expect(can(actor, 'report.branch.read', vinsmc)).toBe(true);
    expect(can(actor, 'grading.read', ans)).toBe(false);
  });

  it('maps legacy branch management to the replacement branch capabilities only', () => {
    const actor: Actor = {
      userId: 'fixture-lead',
      roles: [{ role: 'branch_lead', branchId: 'vinsmc' }],
    };

    expect(can(actor, 'member.read', vinsmc)).toBe(true);
    expect(can(actor, 'membership.manage', vinsmc)).toBe(true);
    expect(can(actor, 'role.definition.read', vinsmc)).toBe(true);
    expect(can(actor, 'role.assignment.branch', vinsmc)).toBe(true);
    expect(can(actor, 'member.manage', vinsmc)).toBe(false);
    expect(can(actor, 'member.read', ans)).toBe(false);
  });

  it('maps a global legacy editor into the review-request workflow without publish escalation', () => {
    const actor: Actor = {
      userId: 'fixture-editor',
      roles: [{ role: 'editor', branchId: null }],
    };

    expect(can(actor, 'content.read', central)).toBe(true);
    expect(can(actor, 'content.create', central)).toBe(true);
    expect(can(actor, 'content.edit', central)).toBe(true);
    expect(can(actor, 'content.review.request', central)).toBe(true);
    expect(can(actor, 'content.publish', central)).toBe(false);
  });
});

describe('global legacy branch-manager aliases', () => {
  it('keeps per-school management without creating Central directory or audit authority', () => {
    const actor: Actor = { userId: 'legacy-lead', roles: [], authorization: { source: 'database', accountStatus: 'active', memberships: [], assignments: [{ roleDefinitionId: 'legacy_branch_lead_central', scope: { kind: 'central' }, permissions: ['admin.access', 'member.read', 'membership.manage', 'role.definition.read', 'role.assignment.branch', 'audit.read', 'opportunity.edit'] }] } };
    expect(can(actor,'member.read',{kind:'central'})).toBe(false);
    expect(hasGlobalPermission(actor,'audit.read')).toBe(false);
    expect(can(actor,'member.read',{kind:'branch',branchId:'ans'})).toBe(true);
    expect(can(actor,'opportunity.edit',{kind:'central'})).toBe(true);
    expect(can(actor,'course.edit',{kind:'central'})).toBe(false);
  });
});

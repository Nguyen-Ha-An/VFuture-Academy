export const PERMISSION_DEFINITIONS = {
  'admin.access': { group: 'admin', scope: 'any' },
  'member.read': { group: 'members', scope: 'any' },
  'member.manage': { group: 'members', scope: 'any' },
  'membership.manage': { group: 'members', scope: 'any' },
  'role.definition.read': { group: 'roles', scope: 'any' },
  'role.definition.manage': { group: 'roles', scope: 'central' },
  'role.assignment.global': { group: 'roles', scope: 'central' },
  'role.assignment.branch': { group: 'roles', scope: 'any' },
  'branch.read': { group: 'branches', scope: 'any' },
  'branch.manage': { group: 'branches', scope: 'central' },
  'content.read': { group: 'content', scope: 'any' },
  'content.create': { group: 'content', scope: 'any' },
  'content.edit': { group: 'content', scope: 'any' },
  'content.review.request': { group: 'content', scope: 'any' },
  'content.review': { group: 'content', scope: 'central' },
  'content.publish': { group: 'content', scope: 'central' },
  'learning.read': { group: 'grading', scope: 'any' },
  'grading.read': { group: 'grading', scope: 'any' },
  'grading.manage': { group: 'grading', scope: 'any' },
  'submission.grade': { group: 'grading', scope: 'any' },
  'exam.release': { group: 'grading', scope: 'any' },
  'report.branch.read': { group: 'reporting', scope: 'any' },
  'report.global.read': { group: 'reporting', scope: 'central' },
  'audit.read': { group: 'audit', scope: 'any' },

  // Existing names remain first-class permissions while consumers migrate to
  // resource-oriented capabilities.
  'course.read': { group: 'legacy-content', scope: 'any' },
  'course.create': { group: 'legacy-content', scope: 'any' },
  'course.edit': { group: 'legacy-content', scope: 'any' },
  'course.publish': { group: 'legacy-content', scope: 'central' },
  'course.delete': { group: 'legacy-content', scope: 'central' },
  'bank.edit': { group: 'legacy-content', scope: 'any' },
  'bank.publish': { group: 'legacy-content', scope: 'central' },
  'media.upload': { group: 'legacy-content', scope: 'any' },
  'resource.edit': { group: 'legacy-content', scope: 'any' },
  'resource.publish': { group: 'legacy-content', scope: 'central' },
  'opportunity.edit': { group: 'legacy-content', scope: 'any' },
  'opportunity.publish': { group: 'legacy-content', scope: 'central' },
  'project.edit': { group: 'legacy-content', scope: 'any' },
  'user.manage.branch': { group: 'legacy-admin', scope: 'any' },
  'user.manage.global': { group: 'legacy-admin', scope: 'central' },
  'analytics.branch.read': { group: 'legacy-reporting', scope: 'any' },
  'analytics.global.read': { group: 'legacy-reporting', scope: 'central' },
} as const satisfies Record<string, {
  group: 'admin' | 'members' | 'roles' | 'branches' | 'content' | 'grading'
    | 'reporting' | 'audit' | 'legacy-content' | 'legacy-admin' | 'legacy-reporting';
  scope: 'any' | 'central';
}>;

export type Permission = keyof typeof PERMISSION_DEFINITIONS;

export const PERMISSIONS = Object.freeze(
  Object.keys(PERMISSION_DEFINITIONS) as Permission[],
);

export const PERMISSION_GROUPS = Object.freeze({
  admin: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'admin'),
  members: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'members'),
  roles: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'roles'),
  branches: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'branches'),
  content: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'content'),
  grading: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'grading'),
  reporting: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'reporting'),
  audit: PERMISSIONS.filter((permission) => PERMISSION_DEFINITIONS[permission].group === 'audit'),
});

export const LEGACY_CONTENT_PERMISSIONS = [
  'course.read',
  'course.create',
  'course.edit',
  'course.publish',
  'course.delete',
  'bank.edit',
  'bank.publish',
  'media.upload',
  'resource.edit',
  'resource.publish',
  'opportunity.edit',
  'opportunity.publish',
  'project.edit',
] as const satisfies readonly Permission[];

export const CENTRAL_ONLY_PERMISSIONS = PERMISSIONS.filter(
  (permission) => PERMISSION_DEFINITIONS[permission].scope === 'central',
);

export const BRANCH_SCOPED_PERMISSIONS = [
  'member.read',
  'member.manage',
  'membership.manage',
  'role.assignment.branch',
  'learning.read',
  'grading.read',
  'grading.manage',
  'submission.grade',
  'exam.release',
  'report.branch.read',
  'audit.read',
  'user.manage.branch',
  'analytics.branch.read',
] as const satisfies readonly Permission[];

export type BranchScopedPermission = (typeof BRANCH_SCOPED_PERMISSIONS)[number];
export type UnscopedPermission = Exclude<Permission, BranchScopedPermission>;

export type LegacyRole = 'contributor' | 'editor' | 'instructor' | 'branch_lead' | 'admin';
export type Role = LegacyRole;

export const ROLE_PERMISSIONS: Record<LegacyRole, Permission[]> = {
  contributor: ['resource.edit'],
  editor: [
    'course.read', 'course.create', 'course.edit', 'bank.edit', 'bank.publish',
    'media.upload', 'resource.edit', 'resource.publish', 'opportunity.edit',
    'opportunity.publish', 'project.edit',
  ],
  instructor: ['course.read', 'submission.grade', 'exam.release', 'analytics.branch.read'],
  branch_lead: [
    'course.read', 'submission.grade', 'exam.release', 'analytics.branch.read',
    'user.manage.branch', 'opportunity.edit',
  ],
  admin: [...PERMISSIONS],
};

export const BUILT_IN_ROLE_PERMISSIONS = {
  central_admin: [...PERMISSIONS],
  central_reviewer: [
    'admin.access', 'content.read', 'content.review', 'content.publish',
    'course.read', 'course.publish', 'bank.publish', 'resource.publish',
    'opportunity.publish',
  ],
  central_editor: [
    'admin.access', 'content.read', 'content.create', 'content.edit',
    'content.review.request', 'course.read', 'course.create', 'course.edit',
    'bank.edit', 'media.upload', 'resource.edit', 'opportunity.edit', 'project.edit',
  ],
  school_admin: [
    'admin.access', 'member.read', 'member.manage', 'membership.manage',
    'role.definition.read', 'role.assignment.branch', 'branch.read', 'learning.read',
    'report.branch.read', 'audit.read', 'user.manage.branch', 'analytics.branch.read',
  ],
  school_editor: [
    'admin.access', 'branch.read', 'content.read', 'content.create', 'content.edit',
    'content.review.request', 'course.read', 'course.create', 'course.edit',
    'bank.edit', 'media.upload', 'resource.edit', 'opportunity.edit', 'project.edit',
  ],
  teacher: [
    'admin.access', 'branch.read', 'learning.read', 'grading.read', 'grading.manage',
    'submission.grade', 'exam.release', 'report.branch.read', 'analytics.branch.read',
  ],
  member: [],
} as const satisfies Record<string, readonly Permission[]>;

export type BuiltInRole = keyof typeof BUILT_IN_ROLE_PERMISSIONS;
export type AccountStatus = 'active' | 'suspended';
export type MembershipStatus = 'active' | 'suspended';
export type Scope = { kind: 'central' } | { kind: 'branch'; branchId: string };
export type ResourceOwner = { kind: 'central' } | { kind: 'branch'; id: string };

export type LegacyRoleTuple = {
  role: LegacyRole;
  branchId: string | null;
};

export type ActorMembership = {
  branchId: string;
  status: MembershipStatus;
};

export type ActorAssignment = {
  roleDefinitionId: string;
  scope: Scope;
  permissions: Permission[];
};

export type ResolvedAuthorization = {
  source: 'database';
  accountStatus: AccountStatus;
  memberships: ActorMembership[];
  assignments: ActorAssignment[];
};

export type Actor = {
  userId: string;
  /** Retained for old unit fixtures. Database actors resolve only authorization. */
  roles: LegacyRoleTuple[];
  authorization?: ResolvedAuthorization;
};

const permissionSet = new Set<string>(PERMISSIONS);
const legacyScopedContentSet = new Set<Permission>([
  ...LEGACY_CONTENT_PERMISSIONS,
  ...PERMISSION_GROUPS.content,
]);
const centralOnlySet = new Set<Permission>(CENTRAL_ONLY_PERMISSIONS);
const legacyBranchAdminPermissions = [
  'submission.grade', 'exam.release', 'user.manage.branch', 'analytics.branch.read',
] as const satisfies readonly Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && permissionSet.has(value);
}

function scopeMatches(assignmentScope: Scope, requestedScope: Scope): boolean {
  if (assignmentScope.kind === 'central') return true;
  return requestedScope.kind === 'branch'
    && assignmentScope.branchId === requestedScope.branchId;
}

function activeMemberships(actor: Actor): Set<string> {
  return new Set(actor.authorization?.memberships.flatMap(({ branchId, status }) =>
    status === 'active' ? [branchId] : []) ?? []);
}

const LEGACY_BRANCH_ONLY_ALIASES = new Set<Permission>(['member.read', 'membership.manage', 'role.definition.read', 'role.assignment.branch', 'audit.read']);

function livePermissions(actor: Actor, scope: Scope): Set<Permission> {
  const authorization = actor.authorization;
  if (!authorization || authorization.accountStatus !== 'active') return new Set();
  const memberships = activeMemberships(actor);
  const permissions = new Set<Permission>();
  for (const assignment of authorization.assignments) {
    if (!scopeMatches(assignment.scope, scope)) continue;
    if (assignment.scope.kind === 'branch' && !memberships.has(assignment.scope.branchId)) continue;
    for (const permission of assignment.permissions) {
      if (!isPermission(permission)) continue;
      if (scope.kind === 'central' && assignment.roleDefinitionId === 'legacy_branch_lead_central' && LEGACY_BRANCH_ONLY_ALIASES.has(permission)) continue;
      if (assignment.scope.kind === 'branch' && centralOnlySet.has(permission)) continue;
      permissions.add(permission);
    }
  }
  return permissions;
}

function legacyPermissions(actor: Actor, scope: Scope): Set<Permission> {
  const permissions = new Set<Permission>();
  for (const assignment of actor.roles) {
    if (assignment.branchId !== null
      && (scope.kind !== 'branch' || scope.branchId !== assignment.branchId)) continue;
    const rolePermissions = assignment.role === 'admin' && assignment.branchId !== null
      ? legacyBranchAdminPermissions
      : ROLE_PERMISSIONS[assignment.role];
    for (const permission of rolePermissions) {
      if (assignment.branchId !== null && legacyScopedContentSet.has(permission)) continue;
      if (scope.kind === 'central' && BRANCH_SCOPED_PERMISSIONS.includes(permission as BranchScopedPermission)) {
        continue;
      }
      permissions.add(permission);
    }
  }

  if (permissions.size > 0) permissions.add('admin.access');
  if (permissions.has('course.read')) permissions.add('content.read');
  if (permissions.has('course.create')) permissions.add('content.create');
  if (['course.edit', 'bank.edit', 'media.upload'].some((permission) =>
    permissions.has(permission as Permission))) {
    permissions.add('content.read');
    permissions.add('content.edit');
    permissions.add('content.review.request');
  }
  if (permissions.has('submission.grade')) {
    permissions.add('learning.read');
    permissions.add('grading.read');
    permissions.add('grading.manage');
  }
  if (permissions.has('analytics.branch.read')) permissions.add('report.branch.read');
  if (permissions.has('analytics.global.read')) permissions.add('report.global.read');
  if (permissions.has('user.manage.branch')) {
    permissions.add('member.read');
    permissions.add('membership.manage');
    permissions.add('role.definition.read');
    permissions.add('role.assignment.branch');
    permissions.add('audit.read');
  }
  return permissions;
}

export function effectivePermissions(actor: Actor, scope: Scope): Permission[] {
  const granted = actor.authorization
    ? livePermissions(actor, scope)
    : legacyPermissions(actor, scope);
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

export function can(actor: Actor, permission: Permission, scope: Scope): boolean {
  return effectivePermissions(actor, scope).includes(permission);
}

export const authorize = can;

export function hasGlobalPermission(actor: Actor, permission: Permission): boolean {
  if (actor.authorization?.accountStatus === 'suspended') return false;
  if (actor.authorization) return livePermissions(actor, { kind: 'central' }).has(permission);
  const globalOnlyActor: Actor = {
    userId: actor.userId,
    roles: actor.roles.filter(({ branchId }) => branchId === null),
  };
  return legacyPermissions(
    globalOnlyActor,
    { kind: 'branch', branchId: '__global_assignment_probe__' },
  ).has(permission);
}

export function allowedBranchIds(actor: Actor, permission: Permission): string[] {
  if (actor.authorization?.accountStatus === 'suspended') return [];
  if (actor.authorization) {
    const memberships = activeMemberships(actor);
    return [...new Set(actor.authorization.assignments.flatMap((assignment) => {
      if (assignment.scope.kind !== 'branch'
        || !memberships.has(assignment.scope.branchId)
        || centralOnlySet.has(permission)
        || !assignment.permissions.includes(permission)) return [];
      return [assignment.scope.branchId];
    }))].sort();
  }
  return [...new Set(actor.roles.flatMap(({ branchId }) =>
    branchId !== null && can(actor, permission, { kind: 'branch', branchId })
      ? [branchId]
      : []))].sort();
}

export const STUDIO_WORKSPACE_PERMISSIONS = [
  ...PERMISSION_GROUPS.content,
  ...PERMISSION_GROUPS.grading,
  ...PERMISSION_GROUPS.reporting,
  'course.read', 'course.create', 'course.edit', 'course.publish', 'course.delete',
  'bank.edit', 'bank.publish', 'media.upload',
  'resource.edit', 'resource.publish', 'opportunity.edit', 'opportunity.publish',
  'project.edit', 'analytics.branch.read', 'analytics.global.read',
] as const satisfies readonly Permission[];

const studioPermissionSet = new Set<Permission>(STUDIO_WORKSPACE_PERMISSIONS);

export function studioPermissions(actor: Actor): Permission[] {
  if (actor.authorization) {
    const scopes: Scope[] = [
      { kind: 'central' },
      ...actor.authorization.memberships.map(({ branchId }): Scope => ({ kind: 'branch', branchId })),
    ];
    const granted = new Set(scopes.flatMap((scope) => effectivePermissions(actor, scope)));
    return PERMISSIONS.filter((permission) => granted.has(permission) && studioPermissionSet.has(permission));
  }
  const scopes: Scope[] = [
    { kind: 'central' },
    ...actor.roles.flatMap(({ branchId }): Scope[] => branchId === null
      ? []
      : [{ kind: 'branch', branchId }]),
  ];
  const granted = new Set(scopes.flatMap((scope) => effectivePermissions(actor, scope)));
  return PERMISSIONS.filter((permission) => studioPermissionSet.has(permission) && granted.has(permission));
}

export function canAccessStudio(actor: Actor): boolean {
  return studioPermissions(actor).length > 0;
}

export function canAccessAdmin(actor: Actor): boolean {
  if (!actor.authorization) {
    const scopes: Scope[] = [
      { kind: 'central' },
      ...actor.roles.flatMap(({ branchId }): Scope[] => branchId === null
        ? []
        : [{ kind: 'branch', branchId }]),
    ];
    return scopes.some((scope) => effectivePermissions(actor, scope).includes('admin.access'));
  }
  return hasGlobalPermission(actor, 'admin.access')
    || allowedBranchIds(actor, 'admin.access').length > 0;
}

export function scopeForResource(owner: ResourceOwner): Scope {
  return owner.kind === 'central'
    ? { kind: 'central' }
    : { kind: 'branch', branchId: owner.id };
}

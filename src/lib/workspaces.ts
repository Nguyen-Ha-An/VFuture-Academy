import {
  LEGACY_CONTENT_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
} from '@/lib/authorization';

/** The three staff workspaces. Each has its own admission, navigation and shell. */
export type StaffWorkspace = 'studio' | 'grading' | 'admin';

export const STAFF_WORKSPACES = Object.freeze(['studio', 'grading', 'admin'] as const satisfies readonly StaffWorkspace[]);

export function isStaffWorkspace(value: unknown): value is StaffWorkspace {
  return value === 'studio' || value === 'grading' || value === 'admin';
}

const WORKSPACE_HOME = Object.freeze({
  studio: '/studio',
  grading: '/grading',
  admin: '/admin',
} as const satisfies Record<StaffWorkspace, string>);

export function workspaceHome(workspace: StaffWorkspace): string {
  return WORKSPACE_HOME[workspace];
}

/**
 * Which capabilities belong to which workspace. This partitions existing
 * permissions for admission and navigation only; no action authorization is
 * derived from it and no permission is widened.
 */
export const WORKSPACE_PERMISSIONS = Object.freeze({
  studio: Object.freeze([
    ...PERMISSION_GROUPS.content,
    ...LEGACY_CONTENT_PERMISSIONS,
  ]) as readonly Permission[],
  grading: Object.freeze([
    ...PERMISSION_GROUPS.grading,
    ...PERMISSION_GROUPS.reporting,
    'analytics.branch.read',
    'analytics.global.read',
  ]) as readonly Permission[],
  admin: Object.freeze([
    ...PERMISSION_GROUPS.admin,
    ...PERMISSION_GROUPS.members,
    ...PERMISSION_GROUPS.roles,
    ...PERMISSION_GROUPS.branches,
    ...PERMISSION_GROUPS.audit,
    'user.manage.branch',
    'user.manage.global',
    // Enrollment-version migration and its audit live in Administration.
    'course.publish',
  ]) as readonly Permission[],
} as const satisfies Record<StaffWorkspace, readonly Permission[]>);

const staffWorkspacePermissionSet = new Set<Permission>(
  STAFF_WORKSPACES.flatMap((workspace) => [...WORKSPACE_PERMISSIONS[workspace]]),
);

/** Every permission that admits an actor to some staff workspace. */
export const STAFF_WORKSPACE_PERMISSIONS = Object.freeze(
  PERMISSIONS.filter((permission) => staffWorkspacePermissionSet.has(permission)),
) as readonly Permission[];

const workspacePermissionSets = Object.freeze({
  studio: new Set<Permission>(WORKSPACE_PERMISSIONS.studio),
  grading: new Set<Permission>(WORKSPACE_PERMISSIONS.grading),
  admin: new Set<Permission>(WORKSPACE_PERMISSIONS.admin),
} as const satisfies Record<StaffWorkspace, ReadonlySet<Permission>>);

/** Keeps only the permissions that shape one workspace's navigation. */
export function workspaceScopedPermissions(
  workspace: StaffWorkspace,
  permissions: readonly Permission[],
): Permission[] {
  const held = new Set(permissions);
  return PERMISSIONS.filter((permission) =>
    held.has(permission) && workspacePermissionSets[workspace].has(permission));
}

/** Resolves the workspace that owns a canonical staff pathname. */
export function workspaceForPathname(pathname: string): StaffWorkspace | null {
  for (const workspace of STAFF_WORKSPACES) {
    const home = WORKSPACE_HOME[workspace];
    if (pathname === home || pathname.startsWith(`${home}/`)) return workspace;
  }
  return null;
}

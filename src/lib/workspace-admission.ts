import {
  effectivePermissions,
  type Actor,
  type Permission,
  type Scope,
} from '@/lib/authorization';
import {
  canEnterWorkspace,
  workspaceEntriesFromAdmission,
  type WorkspaceEntries,
} from '@/lib/workspace-navigation';
import { WORKSPACE_PERMISSIONS, type StaffWorkspace } from '@/lib/workspaces';

const workspaceSets: Record<StaffWorkspace, ReadonlySet<Permission>> = {
  studio: new Set(WORKSPACE_PERMISSIONS.studio),
  grading: new Set(WORKSPACE_PERMISSIONS.grading),
  admin: new Set(WORKSPACE_PERMISSIONS.admin),
};

export function workspacePermissionSet(workspace: StaffWorkspace): ReadonlySet<Permission> {
  return workspaceSets[workspace];
}

/** Central plus every branch the actor is actually attached to. */
export function actorScopes(actor: Actor): Scope[] {
  const branchIds = actor.authorization
    ? actor.authorization.memberships.flatMap(({ branchId, status }) => status === 'active' ? [branchId] : [])
    : actor.roles.flatMap(({ branchId }) => branchId === null ? [] : [branchId]);
  return [
    { kind: 'central' },
    ...[...new Set(branchIds)].map((branchId): Scope => ({ kind: 'branch', branchId })),
  ];
}

/** Every permission the actor holds anywhere. Never narrowed to one workspace. */
export function allScopePermissions(actor: Actor): Permission[] {
  return [...new Set(actorScopes(actor).flatMap((scope) => effectivePermissions(actor, scope)))];
}

/**
 * Landing pages for every workspace the actor may enter. Admission is decided
 * per authorized scope, so a switcher neither hides a workspace the actor can
 * use nor offers a destination that the target scope cannot reach.
 */
export function workspaceEntries(actor: Actor): WorkspaceEntries {
  return workspaceEntriesFromAdmission((workspace) => canEnter(actor, workspace));
}

/** True when some authorized scope reaches a real destination in that workspace. */
export function canEnter(actor: Actor, workspace: StaffWorkspace): boolean {
  return actorScopes(actor).some((scope) => canEnterWorkspace(
    workspace,
    effectivePermissions(actor, scope).filter((permission) => workspaceSets[workspace].has(permission)),
  ));
}

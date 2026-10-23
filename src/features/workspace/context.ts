import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';

import { createSupabaseBranchRepository, type Branch } from '@/features/admin/branches';
import { ADMIN_SCOPE_COOKIE, scopeKey, selectAdminScope, type AdminScope, type AdminScopeOption } from '@/lib/admin-scope';
import { ApiError } from '@/lib/api';
import { loginDestination } from '@/lib/auth';
import {
  BRANCH_SCOPED_PERMISSIONS,
  STUDIO_WORKSPACE_PERMISSIONS,
  can,
  effectivePermissions,
  getActor,
  type Actor,
  type Permission,
} from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  actorScopes,
  allScopePermissions,
  canEnter,
  workspaceEntries,
  workspacePermissionSet,
} from '@/lib/workspace-admission';
import { firstWorkspaceDestination, type WorkspaceEntries } from '@/lib/workspace-navigation';
import { STAFF_WORKSPACES, workspaceHome, type StaffWorkspace } from '@/lib/workspaces';

export type WorkspaceContext = {
  workspace: StaffWorkspace;
  actor: Actor;
  scope: AdminScope;
  options: AdminScopeOption[];
  permissions: Permission[];
  branches: Branch[];
  /** Destinations for every workspace the actor may enter, across all scopes. */
  entries: WorkspaceEntries;
};

/** Legacy combined staff permission set. Retained so existing callers keep their admission. */
const combinedStaffPermissions = new Set<Permission>(STUDIO_WORKSPACE_PERMISSIONS);
const branchPermissions = new Set<Permission>(BRANCH_SCOPED_PERMISSIONS);
function permissionsIn(actor: Actor, scope: AdminScope, allowed: ReadonlySet<Permission>): Permission[] {
  return effectivePermissions(actor, scope).filter((permission) => allowed.has(permission));
}

type Admission = {
  workspace: StaffWorkspace;
  allowed: ReadonlySet<Permission>;
  /** Central permissions that open the whole branch directory in this workspace. */
  directory: readonly Permission[];
  /**
   * `destination` admits a scope only when it reaches a navigation destination.
   * `legacy` keeps the pre-split heuristic: any workspace permission, with
   * Central offered only for authority that is not branch-scoped.
   */
  admit: 'destination' | 'legacy';
  denied: string;
};

const admissions = {
  studio: {
    workspace: 'studio',
    allowed: workspacePermissionSet('studio'),
    directory: ['content.review', 'content.publish'],
    admit: 'destination',
    denied: 'Studio access denied',
  },
  grading: {
    workspace: 'grading',
    allowed: workspacePermissionSet('grading'),
    directory: ['report.global.read', 'analytics.global.read'],
    admit: 'destination',
    denied: 'Assessment and grading access denied',
  },
} as const satisfies Record<'studio' | 'grading', Admission>;

/** Compatibility admission: the pre-split combined Studio surface. */
const combinedAdmission: Admission = {
  workspace: 'studio',
  allowed: combinedStaffPermissions,
  directory: ['report.global.read', 'analytics.global.read', 'content.review', 'content.publish'],
  admit: 'legacy',
  denied: 'Studio access denied',
};

async function resolve(admission: Admission): Promise<WorkspaceContext> {
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');

  const scopes = actorScopes(actor);
  const permitted = (scope: AdminScope) => permissionsIn(actor, scope, admission.allowed);
  const reaches = (scope: AdminScope) => admission.admit === 'destination'
    ? firstWorkspaceDestination(admission.workspace, permitted(scope)) !== null
    : scope.kind === 'central'
      ? permitted(scope).some((permission) => !branchPermissions.has(permission))
      : permitted(scope).length > 0;

  if (!scopes.some(reaches)) throw new ApiError(403, 'FORBIDDEN', admission.denied);

  const allBranches = await createSupabaseBranchRepository(supabaseService()).list();
  const central = { kind: 'central' } as const;
  const centralPermissions = new Set(permitted(central));
  // A branch scope is offered only when it adds authority the actor lacks centrally,
  // so a central operator is not shown every school in the picker.
  const scopeBranches = allBranches.filter((branch) => {
    const scope = { kind: 'branch' as const, branchId: branch.id };
    if (!scopes.some((candidate) => candidate.kind === 'branch' && candidate.branchId === branch.id)) return false;
    if (!reaches(scope)) return false;
    return permitted(scope).some((permission) =>
      branchPermissions.has(permission) || !centralPermissions.has(permission));
  });
  const canReadBranchDirectory = admission.directory.some((permission) => can(actor, permission, central));
  const branches = canReadBranchDirectory ? allBranches : scopeBranches;

  const candidates: Array<{ scope: AdminScope; label: string }> = [];
  if (reaches(central)) candidates.push({ scope: central, label: 'Central' });
  candidates.push(...scopeBranches.map((branch) => ({
    scope: { kind: 'branch' as const, branchId: branch.id },
    label: branch.name,
  })));
  const options = candidates.map((option) => ({ ...option, permissions: permitted(option.scope) }));

  const preference = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value;
  const scope = selectAdminScope(options.map((option) => option.scope), preference);
  if (!scope) throw new ApiError(403, 'FORBIDDEN', admission.denied);

  return {
    workspace: admission.workspace,
    actor,
    scope,
    options,
    permissions: permitted(scope),
    branches,
    entries: workspaceEntries(actor),
  };
}

export const getStudioContext = cache(() => resolve(admissions.studio));
export const getGradingContext = cache(() => resolve(admissions.grading));

/**
 * Combined staff context kept for callers that predate the workspace split.
 * Admission and permission filtering are unchanged from the pre-split behaviour.
 */
export const getWorkspaceContext = cache(() => resolve(combinedAdmission));

export function assertWorkspacePermission(context: WorkspaceContext, permission: Permission): void {
  if (!can(context.actor, permission, context.scope)) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
}

export function assertWorkspaceRequestScope(context: WorkspaceContext, request: Request): void {
  const params = new URL(request.url).searchParams;
  const expectedActor = params.get('actorId');
  if (expectedActor && expectedActor !== context.actor.userId) {
    throw new ApiError(409, 'ACTOR_CHANGED', 'Your signed-in account changed. Reload this workspace.');
  }
  const requested = params.get('scope');
  if (requested !== null && requested !== scopeKey(context.scope)) {
    throw new ApiError(409, 'SCOPE_CHANGED', 'The active workspace scope changed. Reload this workspace.');
  }
}

export function assertWorkspaceSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || (origin && origin !== new URL(request.url).origin)) {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-origin workspace request denied');
  }
}

async function pageContext(
  load: () => Promise<WorkspaceContext>,
  permission?: Permission,
): Promise<WorkspaceContext> {
  try {
    const context = await load();
    if (permission) assertWorkspacePermission(context, permission);
    return context;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(await loginDestination());
    if (error instanceof ApiError && error.status === 403) forbidden();
    throw error;
  }
}

export function studioPageContext(permission?: Permission): Promise<WorkspaceContext> {
  return pageContext(getStudioContext, permission);
}

export function gradingPageContext(permission?: Permission): Promise<WorkspaceContext> {
  return pageContext(getGradingContext, permission);
}

/** Compatibility page context for callers that predate the workspace split. */
export function workspacePageContext(permission?: Permission): Promise<WorkspaceContext> {
  return pageContext(getWorkspaceContext, permission);
}

export { STAFF_WORKSPACES, canEnter, workspaceEntries, workspaceHome, allScopePermissions, type StaffWorkspace };

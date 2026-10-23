import 'server-only';

import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { ApiError } from '@/lib/api';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';
import {
  BRANCH_SCOPED_PERMISSIONS,
  LEGACY_CONTENT_PERMISSIONS,
  PERMISSION_GROUPS,
  allowedBranchIds,
  can,
  canAccessAdmin,
  canAccessStudio,
  hasGlobalPermission,
  isPermission,
  scopeForResource,
  studioPermissions,
  type AccountStatus,
  type Actor,
  type ActorAssignment,
  type ActorMembership,
  type BranchScopedPermission,
  type MembershipStatus,
  type Permission,
  type ResourceOwner,
  type Scope,
  type UnscopedPermission,
} from '@/lib/authorization';

export * from '@/lib/authorization';

/** Existing name retained for consumers that enumerate legacy content actions. */
export const CONTENT_PERMISSIONS = [
  ...PERMISSION_GROUPS.content,
  ...LEGACY_CONTENT_PERMISSIONS,
] as const satisfies readonly Permission[];

export type BranchScope = { branchId: string };
type LegacyScope = { branchId?: string | null };
type ScopeInput = Scope | LegacyScope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return value === 'active' || value === 'suspended';
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return value === 'active' || value === 'suspended';
}

function parseMembership(value: unknown): ActorMembership {
  if (!isRecord(value)
    || typeof value.branchId !== 'string'
    || value.branchId.length === 0
    || !isMembershipStatus(value.status)) {
    throw new Error('Invalid membership');
  }
  return { branchId: value.branchId, status: value.status };
}

function parseScope(value: unknown): Scope {
  if (!isRecord(value)) throw new Error('Invalid assignment scope');
  if (value.kind === 'central') return { kind: 'central' };
  if (value.kind === 'branch'
    && typeof value.branchId === 'string'
    && value.branchId.length > 0) {
    return { kind: 'branch', branchId: value.branchId };
  }
  throw new Error('Invalid assignment scope');
}

function parseAssignment(value: unknown): ActorAssignment {
  if (!isRecord(value)
    || typeof value.roleDefinitionId !== 'string'
    || value.roleDefinitionId.length === 0
    || !Array.isArray(value.permissions)
    || !value.permissions.every(isPermission)) {
    throw new Error('Invalid role assignment');
  }
  return {
    roleDefinitionId: value.roleDefinitionId,
    scope: parseScope(value.scope),
    permissions: [...value.permissions],
  };
}

function parseResolvedAuthorization(value: unknown): NonNullable<Actor['authorization']> {
  if (!isRecord(value)
    || !isAccountStatus(value.accountStatus)
    || !Array.isArray(value.memberships)
    || !Array.isArray(value.assignments)) {
    throw new Error('Invalid authorization');
  }
  return {
    source: 'database',
    accountStatus: value.accountStatus,
    memberships: value.memberships.map(parseMembership),
    assignments: value.assignments.map(parseAssignment),
  };
}

export class ActorResolutionError extends Error {
  constructor(public readonly reason: 'missing_account' | 'unavailable') {
    super('Unable to load authorization');
    this.name = 'ActorResolutionError';
  }
}

export interface ActorResolutionDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

/** Loads persisted account and role assignments without a cookie-bound user client. */
export async function getActorForUserId(userId: string, client: ActorResolutionDatabase): Promise<Actor> {
  try {
    const { data, error } = await client.rpc('authorization_actor', { p_user_id: userId });
    if (error) {
      const reason = error.code === '23503' && error.message?.includes('Authorization account is missing')
        ? 'missing_account' : 'unavailable';
      throw new ActorResolutionError(reason);
    }
    return {
      userId,
      roles: [],
      authorization: parseResolvedAuthorization(data),
    };
  } catch (error) {
    if (error instanceof ActorResolutionError) throw error;
    throw new ActorResolutionError('unavailable');
  }
}

function requestedScope(scope: ScopeInput | undefined): Scope | null {
  if (scope && 'kind' in scope) {
    if (scope.kind === 'central') return { kind: 'central' };
    return scope.branchId.length > 0 ? scope : null;
  }
  return typeof scope?.branchId === 'string' && scope.branchId.length > 0
    ? { kind: 'branch', branchId: scope.branchId }
    : null;
}

/** Fails fast when server code omits the mandatory scope for a branch capability. */
export function assertScopedPermissionUsage(permission: Permission, scope?: ScopeInput): void {
  if (!BRANCH_SCOPED_PERMISSIONS.includes(permission as BranchScopedPermission)) return;
  const parsed = requestedScope(scope);
  if (parsed?.kind !== 'branch') {
    throw new Error(`Branch-scoped permission "${permission}" requires a branchId scope`);
  }
}

/**
 * Compatibility wrapper for old call sites. A missing scope means "global
 * assignment required"; resource authorization must use can() with a Scope.
 */
export function hasPermission(actor: Actor, permission: BranchScopedPermission, scope: BranchScope | Scope): boolean;
export function hasPermission(actor: Actor, permission: UnscopedPermission, scope?: ScopeInput): boolean;
export function hasPermission(actor: Actor, permission: Permission, scope?: ScopeInput): boolean {
  const parsed = requestedScope(scope);
  if (parsed) return can(actor, permission, parsed);
  if (BRANCH_SCOPED_PERMISSIONS.includes(permission as BranchScopedPermission)) return false;
  return hasGlobalPermission(actor, permission);
}

export function hasAnyStudioPermission(actor: Actor): boolean {
  return canAccessStudio(actor);
}

/** Resolves signed-in identity, account status, memberships and persisted roles. */
export async function getActor(): Promise<Actor | null> {
  let user: { id: string } | null;
  try {
    const client = await supabaseUser();
    const { data, error } = await client.auth.getUser();
    if (!data.user && error && isAuthSessionMissingError(error)) return null;
    if (error) throw error;
    user = data.user;
  } catch {
    throw new Error('Unable to authenticate user');
  }

  if (!user) return null;
  return getActorForUserId(user.id, supabaseService());
}

export function requirePermission(permission: BranchScopedPermission, scope: BranchScope | Scope): Promise<Actor>;
export function requirePermission(permission: UnscopedPermission, scope?: ScopeInput): Promise<Actor>;
/** Requires a live actor to hold the requested branch or global permission. */
export async function requirePermission(permission: Permission, scope?: ScopeInput): Promise<Actor> {
  assertScopedPermissionUsage(permission, scope);
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (!hasPermission(actor, permission as UnscopedPermission, scope)) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  return actor;
}

/** Requires permission against the persisted owner of one content resource. */
export async function requireResourcePermission(
  permission: Permission,
  owner: ResourceOwner,
): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (!can(actor, permission, scopeForResource(owner))) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  return actor;
}

export {
  allowedBranchIds,
  can,
  canAccessAdmin,
  canAccessStudio,
  studioPermissions,
};

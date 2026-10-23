import type { Permission } from '@/lib/permissions';

export type AdminScope = { kind: 'central' } | { kind: 'branch'; branchId: string };
export type AdminScopeOption = { scope: AdminScope; label: string; permissions: Permission[] };
export const ADMIN_SCOPE_COOKIE = 'vfuture-admin-scope';

export function scopeKey(scope: AdminScope): string {
  return scope.kind === 'central' ? 'central' : `branch:${scope.branchId}`;
}

export function parseScopeKey(value: string): AdminScope | null {
  if (value === 'central') return { kind: 'central' };
  if (!/^branch:[a-z0-9][a-z0-9-]{0,63}$/.test(value)) return null;
  return { kind: 'branch', branchId: value.slice(7) };
}

/** A stale preference can only select an already-authorized scope. */
export function selectAdminScope(scopes: readonly AdminScope[], preference?: string): AdminScope | null {
  return scopes.find(scope => scopeKey(scope) === preference) ?? scopes[0] ?? null;
}

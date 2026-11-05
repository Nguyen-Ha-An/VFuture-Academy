import { z } from 'zod';
import { scopeKey, type AdminScope, type AdminScopeOption } from '@/lib/admin-scope';
import { routes, withQuery } from '@/lib/routes';
import type { StaffWorkspace } from '@/lib/workspaces';

const branchId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const SchoolNavigationRequestSchema = z.discriminatedUnion('target', [
  z.object({ branchId, target: z.enum(['overview', 'members', 'reports', 'library']) }).strict(),
  z.object({ branchId, target: z.literal('member'), userId: z.uuid() }).strict(),
]);
export type SchoolNavigationRequest = z.infer<typeof SchoolNavigationRequestSchema>;
export type SchoolNavigation = {
  actorId: string;
  workspace: StaffWorkspace;
  activeScope: AdminScope;
  savedScopeKey: string | null;
  targetScope: { kind: 'branch'; branchId: string };
  schoolName: string;
  destination: string;
  /** Safe GET entry for new tabs and for rechecking an unchanged saved scope. */
  href: string;
};

export function schoolTargetWorkspace(target: SchoolNavigationRequest): StaffWorkspace {
  return target.target === 'reports' ? 'grading' : target.target === 'library' ? 'studio' : 'admin';
}

export function schoolTargetHref(target: SchoolNavigationRequest): string {
  return withQuery('/account/school-context', target);
}

function destination(target: SchoolNavigationRequest): string {
  if (target.target === 'member') return routes.admin.user(target.userId);
  if (target.target === 'members') return routes.admin.users();
  if (target.target === 'reports') return routes.grading.reports({ branchId: target.branchId });
  if (target.target === 'library') return routes.studio.library();
  return routes.admin.dashboard();
}

/** The options are server-derived; a URL supplies a target, never authority. */
export function buildSchoolNavigation(context: {
  actor: { userId: string };
  scope: AdminScope;
  options: AdminScopeOption[];
}, target: SchoolNavigationRequest, savedScopeKey: string | null): SchoolNavigation | null {
  const targetScope = { kind: 'branch' as const, branchId: target.branchId };
  const option = context.options.find((candidate) => scopeKey(candidate.scope) === scopeKey(targetScope));
  if (!option) return null;
  const has = (permission: AdminScopeOption['permissions'][number]) => option.permissions.includes(permission);
  const allowed = target.target === 'reports'
    ? has('report.branch.read') || has('analytics.branch.read')
    : target.target === 'library'
      ? has('content.read')
      : has('admin.access') && (target.target === 'overview' || has('member.read'));
  if (!allowed) return null;
  return {
    actorId: context.actor.userId,
    workspace: schoolTargetWorkspace(target),
    activeScope: context.scope,
    savedScopeKey,
    targetScope,
    schoolName: option.label,
    destination: destination(target),
    href: schoolTargetHref(target),
  };
}

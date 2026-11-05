/** Actual app entries; canonical Studio/Grading targets are owned by their own harnesses. */
export const ADMIN_SCREEN_ROUTES = ['/admin', '/admin/users', '/admin/users/[userId]', '/admin/branches', '/admin/branches/[branchId]', '/admin/roles', '/admin/mcp', '/admin/audit', '/admin/enrollment-migration'] as const;
export const ADMIN_ALIASES = [
  ['/admin/analytics', '/grading/reports'], ['/admin/submissions', '/grading/queue'], ['/admin/exams', '/grading/assessments'],
  ['/admin/cms', '/studio/library'], ['/admin/reviews', '/studio/reviews'], ['/admin/bank', '/studio/bank'], ['/admin/bank/[id]', '/studio/bank/[id]'],
  ['/admin/resources', '/studio/resources'], ['/admin/resources/[id]', '/studio/resources/[id]'],
  ['/admin/opportunities', '/studio/opportunities'], ['/admin/opportunities/[id]', '/studio/opportunities/[id]'],
  ['/admin/projects', '/studio/projects'], ['/admin/projects/[id]', '/studio/projects/[id]'],
] as const;
export function canonicalAdminDestination(pathname: string): string | null {
  for (const [source, target] of ADMIN_ALIASES) {
    if (!source.includes('[id]') && source === pathname) return target;
    if (source.includes('[id]')) {
      const prefix = source.slice(0, -4), id = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
      if (id && !id.includes('/')) return target.replace('[id]', id);
    }
  }
  return null;
}
/** Review-only routing to real target fixtures; preserve the production path and query. */
export function canonicalPreviewUrl(pathname: string, search: string): string | null {
  // Option B's exact report target is rendered by the real Teaching fixture,
  // never by a synthetic Admin fallback. This remains a separate local origin.
  const target = pathname === '/grading/reports' ? pathname : canonicalAdminDestination(pathname);
  return target ? `${target.startsWith('/grading/') ? 'http://127.0.0.1:4285' : 'http://127.0.0.1:4284'}${target}${search}` : null;
}

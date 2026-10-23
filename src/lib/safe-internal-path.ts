const INTERNAL_ORIGIN = new URL('https://academy.invalid');

export const REQUESTED_PATH_HEADER = 'x-vfuture-request-path';

export const AUTHENTICATED_PATH_PREFIXES = [
  '/app',
  '/account',
  '/studio',
  '/grading',
  '/admin',
  // Temporary compatibility paths. Remove after legacy navigation links expire.
  '/home',
  '/learn',
  '/resources',
  '/opportunities',
  '/build',
  '/profile',
  '/leaderboard',
  // Public action pages may require sign-in before the visitor can continue.
  '/courses',
  '/projects',
] as const;

/** Restricts post-auth navigation to path-only destinations in authenticated app areas. */
export function safeInternalPath(value?: string | null, fallback = '/app'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;

  try {
    const destination = new URL(value, INTERNAL_ORIGIN);
    if (destination.origin !== INTERNAL_ORIGIN.origin) return fallback;
    const allowed = AUTHENTICATED_PATH_PREFIXES.some((prefix) =>
      destination.pathname === prefix || destination.pathname.startsWith(`${prefix}/`));
    return allowed ? `${destination.pathname}${destination.search}${destination.hash}` : fallback;
  } catch {
    return fallback;
  }
}

import 'server-only';

import { env } from '@/lib/env';

function configuredRedirectOrigins(canonicalOrigin: string): Set<string> {
  const allowed = new Set([canonicalOrigin]);
  for (const value of process.env.AUTH_REDIRECT_ORIGINS?.split(',') ?? []) {
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash) {
        allowed.add(url.origin);
      }
    } catch {
      // Invalid optional entries are ignored; the configured application origin remains safe.
    }
  }
  return allowed;
}

/** Selects only an explicitly trusted origin for host-bound auth session redirects. */
export function authRedirectOrigin(request: Request): URL {
  const canonicalOrigin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  const requestOrigin = new URL(request.url).origin;
  const allowed = configuredRedirectOrigins(canonicalOrigin);
  return new URL(allowed.has(requestOrigin) ? requestOrigin : canonicalOrigin);
}

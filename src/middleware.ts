import { notebookRuntimeUrl } from '@/features/notebooks/config';
import { type NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from '@/lib/security-headers';
import { updateSession } from '@/lib/supabase/middleware';
import { REQUESTED_PATH_HEADER } from '@/lib/safe-internal-path';

export async function middleware(request: NextRequest) {
  request.headers.set(REQUESTED_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const lang = request.nextUrl.searchParams.get('lang');
  const pathname = request.nextUrl.pathname;
  // Unknown public URLs use the same locale as the branded 404. Private surfaces
  // keep their existing profile/cookie behavior and never accept this query override.
  const privateOrUtility = ['/api', '/auth', '/app', '/account', '/admin', '/studio', '/grading', '/home', '/learn', '/build', '/profile', '/leaderboard', '/login', '/signup', '/forgot-password', '/reset-password', '/welcome', '/invite', '/u', '/verify', '/dev', '/_next', '/studio-workers', '/social', '/opengraph-image']
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const acceptsPublicLocale = !privateOrUtility && pathname !== '/robots.txt' && pathname !== '/sitemap.xml';
  const requestedLocale = acceptsPublicLocale && (lang === 'vi' || lang === 'en') ? lang : null;
  if (requestedLocale) request.cookies.set('locale', requestedLocale);

  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const contentSecurityPolicy = buildContentSecurityPolicy({ nonce });
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', contentSecurityPolicy);

  const response = await updateSession(request);
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  // Isolate only notebook workspaces; lesson media and authentication keep their existing policy.
  if ((process.env.NODE_ENV !== 'production' && request.nextUrl.pathname === '/dev/notebook') || /^\/app\/courses\/[^/]+\/items\/[^/]+\/notebook$/.test(request.nextUrl.pathname)
    || /^\/studio\/courses\/[^/]+\/notebooks\/[^/]+$/.test(request.nextUrl.pathname)) {
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), cross-origin-isolated=(self "' + (notebookRuntimeUrl() ? new URL(notebookRuntimeUrl()!).origin : 'https://notebook.invalid') + '")');
  }
  if (requestedLocale) {
    response.cookies.set('locale', requestedLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api/mcp(?:/|$)|\\.well-known/oauth-protected-resource(?:/|$)|studio-workers/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)'],
};

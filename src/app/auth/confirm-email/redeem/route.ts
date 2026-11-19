import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authRedirectOrigin, sameOriginAuthRequest } from '@/lib/auth-redirect-origin';
import { gatewayClientOptions } from '@/lib/backend-gateway';
import { readTextBodyLimited } from '@/lib/body-limit';
import { env } from '@/lib/env';
import { EMAIL_LINK_COOKIE, readEmailLink } from '@/lib/identity/email-link';
import { authLinkRedirect, callbackFailure, completeLegacySignIn, providerFailureReason } from '@/lib/identity/legacy-callback';
import { popupCompletionResponse } from '@/lib/identity/popup-server';
import { academyBackend } from '@/lib/identity/provider';
import { beginPasswordReset } from '@/lib/identity/recovery-receipt';
import { routes } from '@/lib/routes';

function reject(status: number) {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** Only the account confirmed in this browser may receive the provider's pending session cookies. */
export async function POST(request: NextRequest) {
  if (academyBackend() !== 'supabase') return reject(404);
  const appUrl = authRedirectOrigin(request);
  if (!sameOriginAuthRequest(request, appUrl)) return reject(403);
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reject(415);
  let form: URLSearchParams;
  try { form = new URLSearchParams(await readTextBodyLimited(request, 2048)); } catch { return reject(400); }

  const pending = readEmailLink(request.cookies.get(EMAIL_LINK_COOKIE)?.value);
  const recovery = form.get('purpose') === 'recovery';
  const expiredRecovery = () => authLinkRedirect(appUrl, routes.auth.forgotPassword({ error: 'expired' }));
  if (!pending || pending.origin !== appUrl.origin || pending.confirmation !== form.get('confirmation')
    || (pending.type === 'recovery') !== recovery) {
    return recovery ? expiredRecovery() : callbackFailure(appUrl, 'expired', '/app', null);
  }
  const { type, tokenHash, next, popupAttempt } = pending;
  if (form.get('decision') === 'cancel') {
    if (popupAttempt) return popupCompletionResponse(appUrl.origin, popupAttempt, 'error');
    return authLinkRedirect(appUrl, recovery ? routes.auth.forgotPassword() : routes.auth.login({ next }));
  }
  if (form.get('decision') !== 'confirm') return reject(400);
  const email = z.string().trim().max(320).email().safeParse(form.get('email'));
  if (!email.success) {
    return authLinkRedirect(appUrl, routes.auth.confirmEmail({ recovery: recovery ? 1 : undefined, error: 'email' }));
  }
  try {
    // Expose only cookie names so the SDK can retire old chunks. It cannot use the
    // current account as the grant identity or change its cookies on a failed match.
    const previousNames = request.cookies.getAll().map(({ name }) => ({ name, value: '' }));
    const cookieWrites: Parameters<SetAllCookies>[0] = [];
    const candidate = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: { getAll: () => previousNames, setAll: (updates) => { cookieWrites.push(...updates); } },
      ...gatewayClientOptions(process.env, env.NEXT_PUBLIC_SUPABASE_URL),
    });
    const { data, error } = await candidate.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return recovery ? expiredRecovery() : callbackFailure(appUrl, providerFailureReason(error), next, popupAttempt);
    if (type === 'email_change' && !data.session) {
      // Secure email change may require clicking separate links in the old and new mailboxes.
      return authLinkRedirect(appUrl, routes.auth.confirmEmail({ result: 'email-change' }));
    }
    const session = data.session;
    const user = session?.user;
    if (!session || !user?.id || !user.email || user.email.toLowerCase() !== email.data.toLowerCase() || !cookieWrites.length) {
      if (popupAttempt) return popupCompletionResponse(appUrl.origin, popupAttempt, 'error');
      return authLinkRedirect(appUrl, routes.auth.confirmEmail({ recovery: recovery ? 1 : undefined, result: 'account' }));
    }
    const response = recovery
      ? beginPasswordReset(appUrl, session)
      : await completeLegacySignIn(candidate, user.id, appUrl, next, popupAttempt);
    for (const { name, value, options } of cookieWrites) response.cookies.set(name, value, options);
    // Supabase consumes the grant once. Let the short-lived staging cookie expire
    // so an older response cannot delete a newer link opened in another tab.
    return response;
  } catch {
    return recovery ? expiredRecovery() : callbackFailure(appUrl, 'provider', next, popupAttempt);
  }
}

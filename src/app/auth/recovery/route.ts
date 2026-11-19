import { academyBackend } from '@/lib/identity/provider';
import { stageEmailLink } from '@/lib/identity/email-link';
import { authLinkRedirect } from '@/lib/identity/legacy-callback';
import { beginPasswordReset, matchesRecoveryReceipt, recoveryAttemptPattern, recoveryCookieName, recoveryCookieOptions } from '@/lib/identity/recovery-receipt';
import { type NextRequest, NextResponse } from 'next/server';
import { isAuthSessionMissingError, type AuthError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseUser } from '@/lib/supabase/server';
import { authRedirectOrigin, sameOriginAuthRequest } from '@/lib/auth-redirect-origin';
import { gatewayFetch } from '@/lib/backend-gateway';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { env } from '@/lib/env';
import { routes } from '@/lib/routes';

/**
 * Landing point for Supabase recovery emails. A recovery grant is single-use, so every
 * failure — missing, expired or already-redeemed — returns to the request form identically.
 */
export async function GET(request: Request) {
  if (academyBackend() === 'azure') return NextResponse.redirect(new URL('/forgot-password', request.url), 303);
  const requestUrl = new URL(request.url);
  const appUrl = authRedirectOrigin(request);
  const expired = () => authLinkRedirect(appUrl, routes.auth.forgotPassword({ error: 'expired' }));

  const providerError = [
    requestUrl.searchParams.get('error_code'),
    requestUrl.searchParams.get('error'),
    requestUrl.searchParams.get('error_description'),
  ].some(Boolean);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type');
  if (providerError) return expired();

  try {
    if (!code) {
      if (!tokenHash || otpType !== 'recovery') return expired();
      return stageEmailLink(request, appUrl, 'recovery', tokenHash, '/app', null) ?? expired();
    }
    const supabase = await supabaseUser();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.session || !('redirectType' in data) || data.redirectType !== 'PASSWORD_RECOVERY') return expired();
    return beginPasswordReset(appUrl, data.session);
  } catch {
    return expired();
  }
}

const passwordChange = z.object({ attempt: z.string().regex(recoveryAttemptPattern), password: z.string().min(8) }).strict();
const result = (status: number) => new NextResponse(null, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
function sessionFailure(error: AuthError) {
  return result(isAuthSessionMissingError(error) || [400, 401, 403].includes(error.status ?? 0) ? 410 : 503);
}

export async function POST(request: NextRequest) {
  if (academyBackend() !== 'supabase') return result(404);
  const appUrl = authRedirectOrigin(request);
  if (!sameOriginAuthRequest(request, appUrl)) return result(403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return result(415);
  let body: unknown;
  try { body = await readJsonBodyLimited(request, 16_384); } catch { return result(400); }
  const input = passwordChange.safeParse(body);
  if (!input.success) return result(400);
  const { attempt, password } = input.data;
  const receipt = request.cookies.get(recoveryCookieName(attempt))?.value;
  if (!receipt) return result(410);
  try {
    const client = await supabaseUser();
    const current = await client.auth.getSession();
    const token = current.data.session?.access_token;
    if (current.error) return sessionFailure(current.error);
    if (!token) return result(410);
    const verified = await client.auth.getUser(token);
    if (verified.error) return sessionFailure(verified.error);
    if (!verified.data.user || !matchesRecoveryReceipt(receipt, appUrl.origin, attempt, verified.data.user.id, token)) {
      return result(410);
    }
    // Send the exact checked bearer. A later login or a different refresh token
    // cannot change the identity used by this password update.
    const fetchAuth = gatewayFetch(process.env, undefined, env.NEXT_PUBLIC_SUPABASE_URL) ?? fetch;
    const endpoint = new URL('auth/v1/user', env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/?$/, '/'));
    const updated = await fetchAuth(endpoint, {
      method: 'PUT', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
    if (updated.status === 401 || updated.status === 403) return result(410);
    if (updated.status >= 500 || updated.status === 429) return result(503);
    if (!updated.ok) return result(422);
    const response = result(204);
    response.cookies.set(recoveryCookieName(attempt), '', { ...recoveryCookieOptions(appUrl), maxAge: 0 });
    return response;
  } catch {
    return result(503);
  }
}

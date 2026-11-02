import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authRedirectOrigin } from '@/lib/auth-redirect-origin';
import { env } from '@/lib/env';
import { enforceRequestRateLimit } from '@/lib/rate-limit';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { supabaseService, supabaseUser } from '@/lib/supabase/server';
import { POPUP_ATTEMPT_PATTERN } from './popup-contract';
import { popupCompletionResponse } from './popup-server';
const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-academy_popup_legacy' : 'academy_popup_legacy';
const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const signature = (payload: string) => createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(`academy-legacy-popup:${payload}`).digest();
const pendingCookie = (state: string) => `${COOKIE}_pending_${state}`;
function signedContext(value: string | undefined): { state: string; attempt: string; expires: number } {
  if (!value || value.length > 2048) throw new Error('Invalid popup context');
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('Invalid popup context');
  const [payload, encodedSignature] = parts;
  const supplied = Buffer.from(encodedSignature, 'base64url'); const expected = signature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Invalid popup context');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (typeof claims.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(claims.state)
    || typeof claims.expires !== 'number' || claims.expires <= Date.now()
    || typeof claims.attempt !== 'string' || !POPUP_ATTEMPT_PATTERN.test(claims.attempt)) throw new Error('Invalid popup context');
  return claims;
}
/** Legacy Supabase retains its own one-use authorization code and cookie-bound PKCE verifier. */
export async function legacyPopupLogin(request: Request) {
  const url = new URL(request.url); const origin = authRedirectOrigin(request);
  const attempt = url.searchParams.get('attempt');
  if (url.searchParams.get('popup') !== '1' || !attempt || !POPUP_ATTEMPT_PATTERN.test(attempt)) return NextResponse.redirect(new URL('/login', origin), 303);
  if (url.origin !== origin.origin) return NextResponse.redirect(new URL(`/auth/login${url.search}`, origin), 303);
  const provider = url.searchParams.get('provider') === 'google' ? 'google' : url.searchParams.get('provider') === 'azure' || url.searchParams.get('provider') === 'microsoft' ? 'azure' : null;
  if (!provider) return popupCompletionResponse(origin.origin, attempt, 'error');
  try {
    await enforceRequestRateLimit(supabaseService(), 'identity-popup-login', request, { limit: 20, windowSeconds: 60 });
    const state = randomBytes(32).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ state, attempt, expires: Date.now() + 600000 })).toString('base64url');
    const cookie = `${payload}.${signature(payload).toString('base64url')}`;
    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('popup_state', state); callback.searchParams.set('next', safeInternalPath(url.searchParams.get('next')));
    const jar = await cookies();
    // Supersede the previous pending marker without accumulating one cookie per retry.
    try { const previous = signedContext(jar.get(COOKIE)?.value); jar.set(pendingCookie(previous.state), '', { ...options, maxAge: 0 }); } catch { /* No current valid context. */ }
    jar.set(COOKIE, cookie, { ...options, maxAge: 600 });
    jar.set(pendingCookie(state), 'pending', { ...options, maxAge: 600 });
    const client = await supabaseUser();
    const { data, error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: callback.toString(), skipBrowserRedirect: true, ...(provider === 'azure' ? { scopes: 'email' } : {}) } });
    if (error || !data.url) return popupCompletionResponse(origin.origin, attempt, 'error');
    const destination = new URL(data.url);
    if (destination.origin !== new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin || !destination.pathname.startsWith('/auth/v1/')) throw new Error('Untrusted legacy auth endpoint');
    const response = NextResponse.redirect(destination, 303); response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); return response;
  } catch { return popupCompletionResponse(origin.origin, attempt, 'error'); }
}
/** Authenticates and consumes popup display context; it never grants a user session. */
export async function consumeLegacyPopup(request: Request): Promise<string | null> {
  const state = new URL(request.url).searchParams.get('popup_state'); if (!state) return null;
  const jar = await cookies();
  const claims = signedContext(jar.get(COOKIE)?.value);
  if (claims.state !== state || jar.get(pendingCookie(state))?.value !== 'pending') throw new Error('Invalid popup context');
  // Never clear the shared signed cookie in a callback response. An older response
  // can arrive after a new login. This marker belongs only to the validated state.
  jar.set(pendingCookie(state), '', { ...options, maxAge: 0 });
  return claims.attempt;
}

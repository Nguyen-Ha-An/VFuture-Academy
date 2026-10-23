import { NextResponse } from 'next/server';
import { supabaseUser } from '@/lib/supabase/server';
import { authRedirectOrigin } from '@/lib/auth-redirect-origin';
import { profileState } from '@/lib/profile-state';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';

const EMAIL_OTP_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'signup']);

type AuthCallbackFailure = 'cancelled' | 'expired' | 'provider' | 'profile';

function providerFailureReason(value: unknown): AuthCallbackFailure {
  const message = typeof value === 'object' && value !== null
    ? `${'code' in value ? String(value.code) : ''} ${'message' in value ? String(value.message) : ''}`
    : String(value ?? '');
  const normalized = message.toLowerCase();
  if (normalized.includes('expired') || normalized.includes('otp_expired')) return 'expired';
  if (normalized.includes('access_denied') || normalized.includes('cancel')) return 'cancelled';
  return 'provider';
}

function callbackFailure(appUrl: URL, reason: AuthCallbackFailure, next: string) {
  return NextResponse.redirect(new URL(routes.auth.login({ error: reason, next }), appUrl), 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = authRedirectOrigin(request);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type');
  const next = safeInternalPath(requestUrl.searchParams.get('next'));
  const providerError = [
    requestUrl.searchParams.get('error_code'),
    requestUrl.searchParams.get('error'),
    requestUrl.searchParams.get('error_description'),
  ].filter(Boolean).join(' ');
  if (providerError) return callbackFailure(appUrl, providerFailureReason(providerError), next);
  if (!code && (!tokenHash || !otpType || !EMAIL_OTP_TYPES.has(otpType))) {
    return callbackFailure(appUrl, 'provider', next);
  }

  let supabase: Awaited<ReturnType<typeof supabaseUser>>;
  let userId: string;
  try {
    supabase = await supabaseUser();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType as 'email' | 'email_change' | 'invite' | 'magiclink' | 'signup' });
    if (error) return callbackFailure(appUrl, providerFailureReason(error), next);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return callbackFailure(appUrl, 'provider', next);
    userId = userData.user.id;
  } catch {
    return callbackFailure(appUrl, 'provider', next);
  }

  try {
    const profile = await supabase.from('profiles').select('handle').eq('id', userId).maybeSingle();
    const state = profileState(profile);
    if (state === 'unavailable') return callbackFailure(appUrl, 'profile', next);

    const destination = state === 'complete'
      ? next
      : routes.auth.welcome({ next });
    return NextResponse.redirect(new URL(destination, appUrl), 303);
  } catch {
    return callbackFailure(appUrl, 'profile', next);
  }
}

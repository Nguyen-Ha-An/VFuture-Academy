import { NextResponse } from 'next/server';
import { supabaseUser } from '@/lib/supabase/server';
import { authRedirectOrigin } from '@/lib/auth-redirect-origin';
import { routes } from '@/lib/routes';

/**
 * Landing point for Supabase recovery emails. A recovery grant is single-use, so every
 * failure — missing, expired or already-redeemed — returns to the request form identically.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = authRedirectOrigin(request);
  const expired = () => NextResponse.redirect(new URL(routes.auth.forgotPassword({ error: 'expired' }), appUrl), 303);

  const providerError = [
    requestUrl.searchParams.get('error_code'),
    requestUrl.searchParams.get('error'),
    requestUrl.searchParams.get('error_description'),
  ].some(Boolean);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type');
  if (providerError || (!code && (!tokenHash || otpType !== 'recovery'))) return expired();

  try {
    const supabase = await supabaseUser();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'recovery' });
    if (error) return expired();
  } catch {
    return expired();
  }

  return NextResponse.redirect(new URL(routes.auth.resetPassword(), appUrl), 303);
}

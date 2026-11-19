import 'server-only';
import { NextResponse } from 'next/server';
import { profileState } from '@/lib/profile-state';
import { routes } from '@/lib/routes';
import type { supabaseUser } from '@/lib/supabase/server';
import { popupCompletionResponse } from './popup-server';

type AuthCallbackFailure = 'cancelled' | 'expired' | 'provider' | 'profile';

export function providerFailureReason(value: unknown): AuthCallbackFailure {
  const message = typeof value === 'object' && value !== null
    ? `${'code' in value ? String(value.code) : ''} ${'message' in value ? String(value.message) : ''}`
    : String(value ?? '');
  const normalized = message.toLowerCase();
  if (normalized.includes('expired') || normalized.includes('otp_expired')) return 'expired';
  if (normalized.includes('access_denied') || normalized.includes('cancel')) return 'cancelled';
  return 'provider';
}

export function authLinkRedirect(appUrl: URL, destination: string) {
  const response = NextResponse.redirect(new URL(destination, appUrl), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export function callbackFailure(appUrl: URL, reason: AuthCallbackFailure, next: string, popupAttempt: string | null) {
  if (popupAttempt) return popupCompletionResponse(appUrl.origin, popupAttempt, 'error');
  return authLinkRedirect(appUrl, routes.auth.login({ error: reason, next }));
}

export async function completeLegacySignIn(
  supabase: Awaited<ReturnType<typeof supabaseUser>>, userId: string, appUrl: URL, next: string, popupAttempt: string | null,
) {
  try {
    const profile = await supabase.from('profiles').select('handle,display_name').eq('id', userId).maybeSingle();
    const state = profileState(profile);
    if (state === 'unavailable') return callbackFailure(appUrl, 'profile', next, popupAttempt);
    if (popupAttempt) return popupCompletionResponse(appUrl.origin, popupAttempt, 'success');
    return authLinkRedirect(appUrl, state === 'complete' ? next : routes.auth.welcome({ next }));
  } catch {
    return callbackFailure(appUrl, 'profile', next, popupAttempt);
  }
}

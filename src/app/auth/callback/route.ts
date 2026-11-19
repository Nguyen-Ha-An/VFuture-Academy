import { signInEmailTypes, stageEmailLink } from '@/lib/identity/email-link';
import { callbackFailure, completeLegacySignIn, providerFailureReason } from '@/lib/identity/legacy-callback';
import { academyBackend } from '@/lib/identity/provider';
import { supabaseUser } from '@/lib/supabase/server';
import { authRedirectOrigin } from '@/lib/auth-redirect-origin';
import { safeInternalPath } from '@/lib/safe-internal-path';

export async function GET(request: Request) {
  if (academyBackend() === 'azure') return (await import('@/lib/identity/routes')).azureCallback(request);
  const requestUrl = new URL(request.url);
  const appUrl = authRedirectOrigin(request);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const otpType = requestUrl.searchParams.get('type');
  const next = safeInternalPath(requestUrl.searchParams.get('next'));
  let popupAttempt: string | null = null;
  if (requestUrl.searchParams.has('popup_state')) {
    try { popupAttempt = await (await import('@/lib/identity/legacy-popup')).consumeLegacyPopup(request); } catch { return callbackFailure(appUrl, 'provider', next, popupAttempt); }
  }
  const providerError = [
    requestUrl.searchParams.get('error_code'),
    requestUrl.searchParams.get('error'),
    requestUrl.searchParams.get('error_description'),
  ].filter(Boolean).join(' ');
  if (providerError) return callbackFailure(appUrl, providerFailureReason(providerError), next, popupAttempt);
  try {
    if (!code) {
      const type = signInEmailTypes.safeParse(otpType);
      if (!tokenHash || !type.success) return callbackFailure(appUrl, 'provider', next, popupAttempt);
      return stageEmailLink(request, appUrl, type.data, tokenHash, next, popupAttempt)
        ?? callbackFailure(appUrl, 'provider', next, popupAttempt);
    }
    const supabase = await supabaseUser();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return callbackFailure(appUrl, providerFailureReason(error), next, popupAttempt);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return callbackFailure(appUrl, 'provider', next, popupAttempt);
    return completeLegacySignIn(supabase, userData.user.id, appUrl, next, popupAttempt);
  } catch {
    return callbackFailure(appUrl, 'provider', next, popupAttempt);
  }
}

import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { routes } from '@/lib/routes';
import { authLinkRedirect } from './legacy-callback';

const WINDOW_SECONDS = 600;
export const recoveryAttemptPattern = /^[A-Za-z0-9_-]{32}$/;
export const recoveryCookieName = (attempt: string) =>
  `${process.env.NODE_ENV === 'production' ? '__Host-' : ''}academy_recovery_${attempt}`;
export function recoveryCookieOptions(appUrl: URL) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production' || appUrl.protocol === 'https:', sameSite: 'lax' as const, path: '/' };
}

// Both callers supply a token received from Auth or checked by Auth's getUser(token).
// A refreshed JWT keeps its session_id. Older tokens without that claim require an exact match.
function sessionBinding(accessToken: string): string {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    if (typeof claims.session_id === 'string' && claims.session_id.length > 0 && claims.session_id.length <= 128) {
      return `session:${claims.session_id}`;
    }
  } catch { /* Legacy token. */ }
  return `access:${createHash('sha256').update(accessToken).digest('base64url')}`;
}

function signature(origin: string, attempt: string, expiry: string, userId: string, token: string) {
  const binding = JSON.stringify(['academy-password-recovery-v1', origin, attempt, expiry, userId, sessionBinding(token)]);
  return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(binding).digest();
}

/** Each recovered session gets a distinct form and HttpOnly proof, including in separate tabs. */
export function beginPasswordReset(appUrl: URL, session: { user: { id: string }; access_token: string }) {
  if (!session.user?.id || !session.access_token) throw new Error('Missing recovery session');
  const attempt = randomBytes(24).toString('base64url');
  const expiry = String(Math.floor(Date.now() / 1000) + WINDOW_SECONDS);
  const receipt = `${expiry}.${signature(appUrl.origin, attempt, expiry, session.user.id, session.access_token).toString('base64url')}`;
  const response = authLinkRedirect(appUrl, routes.auth.resetPassword({ recovery: attempt }));
  response.cookies.set(recoveryCookieName(attempt), receipt, { ...recoveryCookieOptions(appUrl), maxAge: WINDOW_SECONDS });
  return response;
}

export function matchesRecoveryReceipt(receipt: string, origin: string, attempt: string, userId: string, accessToken: string) {
  const parts = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(receipt);
  if (!parts || Number(parts[1]) <= Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(Buffer.from(parts[2], 'base64url'), signature(origin, attempt, parts[1], userId, accessToken));
}

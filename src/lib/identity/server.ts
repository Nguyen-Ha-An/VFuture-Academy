import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { decryptRefreshToken, hashToken, readIdentitySessionConfiguration } from './oidc';
import { decodeGoogleRefresh, GOOGLE_REFRESH_PREFIX } from './google';
import { refreshAzureSession } from './refresh';
import { deleteStoredSession, readStoredSession, type StoredSession } from './store';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-academy_session' : 'academy_session';
export const LOGIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-academy_login' : 'academy_login';
export const sessionCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
export type AcademySession = { user: User; expiresAt: number };
const refreshing = new Map<string, Promise<StoredSession | null>>();
/** Cookie is only a random lookup key. Every request checks server-side expiry/revocation. */
export async function getAzureSession(): Promise<AcademySession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashToken(token);
  let session = await readStoredSession(hash);
  if (!session || session.expiresAt <= Date.now() / 1000) return null;
  if (session.tokenExpiresAt <= Date.now() / 1000 + 60) {
    let pending = refreshing.get(hash);
    if (!pending) { pending = refreshAzureSession(hash, session); refreshing.set(hash, pending); }
    try { session = await pending; } finally { if (refreshing.get(hash) === pending) refreshing.delete(hash); }
  }
  if (!session) return null;
  const google = sessionGoogleCredential(hash,session);
  return { user: google ? { ...session.user,email:google.email,user_metadata:{...session.user.user_metadata,...(google.displayName?{full_name:google.displayName}:{})} } : session.user, expiresAt:session.expiresAt };
}
export async function getAzureUser(): Promise<User | null> { return (await getAzureSession())?.user || null; }
export async function revokeAzureSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashToken(token);
  // Inspect the authenticated protocol before deleting the database record.
  // Even a corrupt credential cannot prevent local logout.
  let google = false;
  try {
    const session = await readStoredSession(hash);
    google = session ? Boolean(sessionGoogleCredential(hash,session)) : false;
  } catch { google = true; }
  const provider = await deleteStoredSession(hash);
  return google && provider === 'external-id' ? 'google' as const : provider;
}

function sessionGoogleCredential(hash: string, session: StoredSession) {
  if (session.provider !== 'external-id' || !session.refreshCiphertext) return null;
  const credential = decryptRefreshToken(session.refreshCiphertext,hash,{...readIdentitySessionConfiguration(),provider:session.provider});
  if (!credential.startsWith(GOOGLE_REFRESH_PREFIX)) return null;
  const google = decodeGoogleRefresh(credential);
  if (google.subject !== session.oidcSubject) throw new Error('Session identity changed');
  return google;
}

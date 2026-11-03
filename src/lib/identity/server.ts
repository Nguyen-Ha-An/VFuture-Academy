import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { hashToken } from './oidc';
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
  return session ? { user: session.user, expiresAt: session.expiresAt } : null;
}
export async function getAzureUser(): Promise<User | null> { return (await getAzureSession())?.user || null; }
export async function revokeAzureSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashToken(token);
  return deleteStoredSession(hash);
}

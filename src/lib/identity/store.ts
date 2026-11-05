import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAzureDataClient } from '@/lib/database/azure-client';
import type { IdentityClaims, IdentityProvider, LoginTransaction } from './oidc';

type UserRow = { id: string; email?: string; raw_user_meta_data?: Record<string, unknown>; created_at: string };
function authUser(row: UserRow): User {
  return { id: row.id, email: row.email || undefined, user_metadata: row.raw_user_meta_data || {}, app_metadata: { provider: 'entra' }, aud: 'authenticated', created_at: row.created_at };
}
async function rpc<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data, error } = await createAzureDataClient('service_role').rpc(name, args).abortSignal(signal ?? AbortSignal.timeout(10_000));
  if (error) throw new Error('Identity storage unavailable');
  return data as T;
}
export async function storeLoginTransaction(stateHash: string, browserHash: string, transaction: LoginTransaction) {
  await storeIdentityTransaction(stateHash,browserHash,transaction);
}
export async function consumeLoginTransaction(stateHash: string, browserHash: string): Promise<LoginTransaction | null> {
  return await consumeIdentityTransaction(stateHash,browserHash) as LoginTransaction|null;
}
export async function storeIdentityTransaction(stateHash:string,browserHash:string,payload:Record<string,unknown>) {
  await rpc('academy_identity_start_login',{p_state_hash:stateHash,p_browser_hash:browserHash,p_payload:payload});
}
export async function consumeIdentityTransaction(stateHash:string,browserHash:string):Promise<Record<string,unknown>|null> {
  return rpc('academy_identity_consume_login',{p_state_hash:stateHash,p_browser_hash:browserHash});
}
/** Read-only mapping for API tokens; never provisions an identity or links by email. */
export async function findIdentityUser(issuer: string, objectId: string): Promise<User | null> {
  const row = await rpc<UserRow | null>('academy_identity_find_user', { p_issuer: issuer, p_subject: objectId });
  return row ? authUser(row) : null;
}
export async function findMicrosoftStaffUser(issuer: string, objectId: string): Promise<User | null> {
  const row = await rpc<UserRow | null>('academy_identity_find_staff', { p_issuer: issuer, p_subject: objectId });
  return row ? authUser(row) : null;
}
export async function resolveIdentityUser(claims: IdentityClaims): Promise<User> {
  const email = typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : null;
  const row = await rpc<UserRow>('academy_identity_resolve_user', { p_issuer: claims.iss, p_subject: claims.oid, p_email: email,
    p_email_verified: claims.email_verified === true, p_display_name: typeof claims.name === 'string' ? claims.name.slice(0, 160) : '' });
  return authUser(row);
}
export type StoredSession = { provider: IdentityProvider; user: User; issuer: string; subject: string; oidcSubject: string; expiresAt: number; tokenExpiresAt: number; refreshCiphertext: string | null; version: number };
export async function createStoredSession(hash: string, session: Omit<StoredSession, 'version'>) {
  await rpc('academy_identity_create_session', { p_provider: session.provider, p_hash: hash, p_user_id: session.user.id, p_issuer: session.issuer, p_subject: session.subject, p_oidc_subject: session.oidcSubject,
    p_expires_at: new Date(session.expiresAt * 1000).toISOString(), p_token_expires_at: new Date(session.tokenExpiresAt * 1000).toISOString(), p_refresh_ciphertext: session.refreshCiphertext });
}
export async function readStoredSession(hash: string, signal?: AbortSignal): Promise<StoredSession | null> {
  const row = await rpc<{ provider: IdentityProvider; user: UserRow; issuer: string; subject: string; oidc_subject: string; expires_at: string; token_expires_at: string; refresh_ciphertext: string | null; version: number } | null>('academy_identity_read_session', { p_hash: hash }, signal);
  if (!row) return null;
  return { provider: row.provider, user: authUser(row.user), issuer: row.issuer, subject: row.subject, oidcSubject: row.oidc_subject, expiresAt: Date.parse(row.expires_at) / 1000, tokenExpiresAt: Date.parse(row.token_expires_at) / 1000, refreshCiphertext: row.refresh_ciphertext, version: row.version };
}
export async function rotateStoredSession(hash: string, version: number, tokenExpiresAt: number, refreshCiphertext: string, lease: string) {
  return rpc<boolean>('academy_identity_rotate_session', { p_hash: hash, p_version: version, p_lease: lease, p_token_expires_at: new Date(tokenExpiresAt * 1000).toISOString(), p_refresh_ciphertext: refreshCiphertext });
}
export async function deleteStoredSession(hash: string, version?: number) { return rpc<IdentityProvider | null>('academy_identity_delete_session', { p_hash: hash, p_version: version ?? null }); }

export async function claimSessionRefresh(hash: string, version: number, lease: string) {
  return rpc<boolean>('academy_identity_claim_refresh', { p_hash: hash, p_version: version, p_lease: lease });
}
export async function releaseSessionRefresh(hash: string, version: number, lease: string) {
  return rpc<boolean>('academy_identity_release_refresh', { p_hash: hash, p_version: version, p_lease: lease });
}
export async function revokeSessionRefresh(hash: string, version: number, lease: string) {
  return rpc<boolean>('academy_identity_revoke_refresh', { p_hash: hash, p_version: version, p_lease: lease });
}

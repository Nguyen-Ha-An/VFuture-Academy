/** Non-authenticating invalidation hints. Only the server can validate an actor. */
export const IDENTITY_CHANGED_EVENT = 'vfuture:auth:changed';
export const IDENTITY_SIGNED_OUT_KEY = 'vfuture:auth:signed-out';

/** Call after the server has confirmed a new login, including an account switch. */
export function notifyIdentityChanged(): void {
  try { window.localStorage.setItem(IDENTITY_CHANGED_EVENT, crypto.randomUUID()); } catch { /* Returning-tab checks still validate the server session. */ }
  window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
}

/** Submit-time intent only conceals other tabs; server logout still revokes access. */
export function notifyIdentitySignedOut(): void {
  try { window.localStorage.setItem(IDENTITY_SIGNED_OUT_KEY, crypto.randomUUID()); } catch { /* Native form submission remains authoritative. */ }
}

import { IDENTITY_CHANGED_EVENT, IDENTITY_SIGNED_OUT_KEY } from './browser-session';

/**
 * How long one tab reuses a successful same-actor server check. Shared by every
 * mounted session guard in the tab, so switching between the separately laid
 * out App, Admin, Studio and Teaching workspaces does not conceal and recheck.
 * This is only a UI optimization held in memory; every API request remains
 * authorized on the server.
 */
export const SESSION_FRESHNESS_MS = 5 * 60 * 1000;

let validated: { actorId: string; at: number } | null = null;
let listening = false;

/** Identity hints must clear freshness even while no guard is mounted. */
function listenForIdentityHints() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', event => {
    if (event.newValue && (event.key === IDENTITY_SIGNED_OUT_KEY || event.key === IDENTITY_CHANGED_EVENT)) validated = null;
  });
  window.addEventListener(IDENTITY_CHANGED_EVENT, () => { validated = null; });
}

/** Record a server-confirmed actor for this tab. */
export function markSessionValidated(actorId: string, at = Date.now()): void {
  listenForIdentityHints();
  validated = { actorId, at };
}

/** True only for the same actor within the freshness window. */
export function isSessionFresh(actorId: string, now = Date.now()): boolean {
  if (!validated || validated.actorId !== actorId) return false;
  const age = now - validated.at;
  return age >= 0 && age < SESSION_FRESHNESS_MS;
}

/** Forget any reusable validation (check started, failure, hint, actor change). */
export function invalidateSessionFreshness(): void {
  validated = null;
}

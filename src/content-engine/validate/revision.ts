import { stableStringify } from '../compile/checksum';
import { refKey, type DocumentRef } from '../diagnostics';

/**
 * Two different questions get two different answers here.
 *
 * "Is the report/preview I am holding still about the text on screen?" is a cheap
 * invalidation question, answered by `*Revision` — a short synchronous hash that is
 * identical in the browser and on the server. A collision would show a stale report,
 * which the next keystroke corrects.
 *
 * "Did my save actually land?" is not that question. A hash is never proof, so the
 * timeout path compares the canonical serialization of the submitted snapshot against
 * the snapshot the server returned, exactly, via `sameWorkspaceSnapshot`.
 */

/** Canonical, key-order-independent serialization. Exact — no hashing, no truncation. */
export const canonicalJson = (value: unknown): string => stableStringify(value);

/** FNV-1a, 32 bit, hex. Cheap and dependency-free; a change hint, never an identity proof. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Change hint for one raw document's text. */
export const sourceRevision = (text: string): string => `${text.length.toString(36)}-${fnv1a(text)}`;

/** Change hint for a map of raw sources keyed by `refKey`. */
export function sourcesRevision(sources: Record<string, string>): string {
  const parts = Object.keys(sources).sort().map((key) => `${key}:${sourceRevision(sources[key])}`);
  return fnv1a(parts.join(' '));
}

export const documentSourceKey = (ref: DocumentRef): string => refKey(ref);

export interface WorkspaceSnapshot {
  manifest: unknown;
  items: Record<string, unknown>;
  baseVersionId?: string | null;
}

/**
 * Canonical serialization of a complete workspace snapshot, including the base
 * version it was edited from. Item keys are sorted, so a differently ordered but
 * otherwise identical snapshot compares equal.
 */
export function canonicalWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  const items = Object.keys(snapshot.items).sort().map((id) => `${JSON.stringify(id)}:${canonicalJson(snapshot.items[id])}`);
  return `${canonicalJson(snapshot.manifest)} {${items.join(',')}} ${snapshot.baseVersionId ?? ''}`;
}

/**
 * Exact snapshot equality. This is what an uncertain save must use before it reports
 * success: after a timeout the client re-reads the stored draft and only treats the
 * write as landed when the stored manifest, every item document and the base version
 * match what it submitted.
 */
export const sameWorkspaceSnapshot = (a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean =>
  canonicalWorkspaceSnapshot(a) === canonicalWorkspaceSnapshot(b);

/** Change hint for a whole workspace. Pairs with `sameWorkspaceSnapshot`, never replaces it. */
export const workspaceRevision = (manifest: unknown, items: Record<string, unknown>): string =>
  fnv1a(canonicalWorkspaceSnapshot({ manifest, items }));

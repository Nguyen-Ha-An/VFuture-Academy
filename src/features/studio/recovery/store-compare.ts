import { ID_PATTERN } from '@/content-engine/schema/common';

/** Exact, order-independent comparison of two raw-source maps. */
export function sameSources(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && right[key] === left[key]);
}

/**
 * The only shape a stored `sources` map may have: exactly the `refKey` values the
 * editor writes, with a course source always present.
 *
 * A record read back from IndexedDB has never been through the import codec — it
 * could have been hand-edited, or written by a build that keyed sources by the
 * legacy `docId` string. Accepting a stray key would materialise a document nobody
 * authored, so the whole record is refused instead.
 */
export function validSourceKeys(sources: unknown): sources is Record<string, string> {
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) return false;
  const entries = Object.entries(sources as Record<string, unknown>);
  if (!entries.some(([key]) => key === 'course')) return false;
  return entries.every(([key, text]) =>
    typeof text === 'string'
    && (key === 'course' || (key.startsWith('item:') && ID_PATTERN.test(key.slice('item:'.length)))));
}

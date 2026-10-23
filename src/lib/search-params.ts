import type { RouteQueryValue } from '@/lib/routes';

type SearchParamValue = string | readonly string[] | undefined;

/**
 * Returns the first value that is not empty after trimming, trimmed. Empty and
 * whitespace-only params (`?type=`, `?search=%20`) are absent, never invalid.
 */
export function firstNonEmpty(value: SearchParamValue): string | undefined {
  const values = typeof value === 'string' ? [value] : value ?? [];
  for (const entry of values) {
    const trimmed = entry.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Copies a filter form's values into a query without empty or whitespace-only
 * entries, and without the keys in `drop` (a changed filter restarts at page 1).
 * File entries are ignored; repeated keys keep their order.
 */
export function compactSearchParams(
  input: FormData | URLSearchParams,
  drop: readonly string[] = ['page'],
): URLSearchParams {
  const output = new URLSearchParams();
  input.forEach((value, key) => {
    if (drop.includes(key) || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) output.append(key, trimmed);
  });
  return output;
}

/**
 * A stable key for a set of applied filters: non-empty values only, sorted by
 * key. Used to remount uncontrolled filter forms when the effective filters change.
 */
export function filterStateKey(
  filters: Readonly<Record<string, RouteQueryValue | readonly RouteQueryValue[]>>,
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const raw = filters[key];
    const values = (Array.isArray(raw) ? raw : [raw]) as readonly RouteQueryValue[];
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const serialized = String(value).trim();
      if (serialized) search.append(key, serialized);
    }
  }
  return search.toString();
}

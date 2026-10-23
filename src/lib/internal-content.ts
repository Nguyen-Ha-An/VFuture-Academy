import 'server-only';

import { ID_PATTERN } from '@/content-engine/schema/common';

/** Every seeded QA fixture id starts with this prefix (scripts/lib/recovery-fixtures.ts). */
export const INTERNAL_ID_PREFIX = 'recovery-';

export type InternalContentPolicy = {
  hidden: boolean;
  ids: ReadonlySet<string>;
};

/**
 * Reads the fixture guard. `HIDE_INTERNAL_CONTENT=1` hides `recovery-*` rows plus
 * any valid ids listed in `INTERNAL_CONTENT_IDS` from learner lists and public
 * surfaces; learner detail pages stay reachable so enrolled learners keep them.
 */
export function internalContentPolicy(env: NodeJS.ProcessEnv = process.env): InternalContentPolicy {
  const hidden = env.HIDE_INTERNAL_CONTENT?.trim() === '1';
  const ids = new Set((env.INTERNAL_CONTENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => ID_PATTERN.test(id)));
  return { hidden, ids };
}

export function isInternalContentId(id: string, policy: InternalContentPolicy = internalContentPolicy()): boolean {
  return policy.hidden && (id.startsWith(INTERNAL_ID_PREFIX) || policy.ids.has(id));
}

export function withoutInternalContent<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  policy: InternalContentPolicy = internalContentPolicy(),
): T[] {
  return policy.hidden ? rows.filter((row) => !isInternalContentId(idOf(row), policy)) : [...rows];
}

/** Stable cache-key part, so a toggled policy never reuses a list cached under the other one. */
export function internalContentFingerprint(policy: InternalContentPolicy = internalContentPolicy()): string {
  return policy.hidden ? `internal:hidden:${[...policy.ids].sort().join(',')}` : 'internal:shown';
}

type NotFilterable<Q> = { not(column: string, operator: string, value: string): Q };

/** SQL form of the guard, so paginated counts exclude hidden rows too. */
export function excludeInternalContent<Q extends NotFilterable<Q>>(
  query: Q,
  policy: InternalContentPolicy = internalContentPolicy(),
  column = 'id',
): Q {
  if (!policy.hidden) return query;
  let next = query.not(column, 'like', `${INTERNAL_ID_PREFIX}%`);
  // Ids passed ID_PATTERN, so they need no quoting inside the PostgREST list.
  if (policy.ids.size) next = next.not(column, 'in', `(${[...policy.ids].sort().join(',')})`);
  return next;
}

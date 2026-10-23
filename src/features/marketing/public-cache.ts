import 'server-only';

import { revalidateTag } from 'next/cache';

export const PUBLIC_CACHE_TAGS = {
  courses: 'public:courses', resources: 'public:resources', opportunities: 'public:opportunities', projects: 'public:projects',
} as const;

export type PublicCacheKind = keyof typeof PUBLIC_CACHE_TAGS;

/** Call from Next request handlers after a successful public-state mutation. */
export function invalidatePublicCache(
  kind: PublicCacheKind,
  invalidate: (tag: string) => unknown = revalidateTag,
) {
  try {
    invalidate(PUBLIC_CACHE_TAGS[kind]);
  } catch (error) {
    // Publication services also run from seed/import scripts, and route handlers are
    // unit-tested without a Next request store. The mutation remains authoritative;
    // only this specific unavailable cache context may be ignored.
    if (error instanceof Error && error.message.includes('static generation store missing')) return;
    throw error;
  }
}

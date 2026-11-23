import type { LessonRuntime } from '@/content-engine/render/runtime';
import { collectAssetRefs } from '@/content-engine/validate/semantic/refs';
import { mediaHref } from '@/features/media/urls';

/** Authored media follows the current attempt projection. Learner uploads keep their own download binding. */
export function attemptMediaRuntime(runtime: LessonRuntime, attemptId: string, authoredContent: unknown, mediaLocale = runtime.locale): LessonRuntime {
  const assets = new Set(collectAssetRefs(authoredContent).map((ref) => ref.id));
  return {
    ...runtime,
    resolveMedia(ref) {
      const url = runtime.resolveMedia(ref);
      if (!('assetId' in ref) || !assets.has(ref.assetId) || url !== mediaHref(ref.assetId)) return url;
      return `${url}?${new URLSearchParams({ examAttemptId: attemptId, locale: mediaLocale })}`;
    },
  };
}

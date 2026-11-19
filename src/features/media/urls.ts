import type { MediaRef } from '@/content-engine/schema/common';

/** Returns the authenticated application URL for a private media asset. */
export function mediaHref(assetId: string): string {
  return `/api/v1/media/${encodeURIComponent(assetId)}`;
}

export function learnerMediaHref(ref: MediaRef): string {
  if ('url' in ref) return ref.url;
  const url = mediaHref(ref.assetId);
  if ('quizAttemptId' in ref && typeof ref.quizAttemptId === 'string') {
    const params = new URLSearchParams({ quizAttemptId: ref.quizAttemptId });
    if ('quizMediaLocale' in ref && (ref.quizMediaLocale === 'vi' || ref.quizMediaLocale === 'en')) params.set('locale', ref.quizMediaLocale);
    return `${url}?${params}`;
  }
  return 'quizMediaReceipt' in ref && typeof ref.quizMediaReceipt === 'string'
    ? `${url}?${new URLSearchParams({ quizMediaReceipt: ref.quizMediaReceipt })}`
    : url;
}

/** URL for assets proven to be referenced by an anonymous public projection. */
export function publicMediaHref(assetId: string): string {
  return `/api/v1/public/media/${encodeURIComponent(assetId)}`;
}

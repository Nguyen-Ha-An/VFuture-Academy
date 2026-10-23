import { CONTENT_STAGES, contentStage, type ContentStage } from '@/features/content-review/lifecycle';
import { isStatusValue, type StatusTone } from '@/features/staff-ui/components/status-tones';

export { CONTENT_STAGES, type ContentStage };

/**
 * Tone per lifecycle stage for StatusBadge (label + tone overrides). The kit has no "stage"
 * status kind yet; this mirrors the review tones: waiting on staff = warning, rework = danger.
 */
export const STAGE_TONES: Record<ContentStage, StatusTone> = {
  draft: 'neutral',
  in_review: 'warning',
  changes_requested: 'danger',
  approved: 'info',
  published: 'success',
  archived: 'outline',
};

/** Grayscale series colour per stage for the stacked "Content by type" chart. */
export const STAGE_COLORS: Record<ContentStage, string> = {
  draft: 'var(--chart-5)',
  in_review: 'var(--chart-4)',
  changes_requested: 'var(--chart-3)',
  approved: 'var(--chart-2)',
  published: 'var(--chart-1)',
  archived: 'var(--border)',
};

export function isContentStage(value: string | null | undefined): value is ContentStage {
  return typeof value === 'string' && (CONTENT_STAGES as readonly string[]).includes(value);
}

/**
 * The lifecycle stage of one cms_list_content row. Rows whose status is not a content status
 * (media assets report "asset") only get a stage while a live review decides it; otherwise null,
 * and they stay out of stage counts rather than being forced into one.
 */
export function rowStage(row: { status: string; review_status?: string | null }): ContentStage | null {
  const review = row.review_status && isStatusValue('review', row.review_status) ? row.review_status : null;
  if (isStatusValue('content', row.status)) return contentStage({ reviewStatus: review, contentStatus: row.status });
  if (review === 'pending' || review === 'changes_requested' || review === 'approved') {
    return contentStage({ reviewStatus: review, contentStatus: 'draft' });
  }
  return null;
}

/** Title as stored ({vi,en} object or string), resolved for a locale with the other language as fallback. */
export function localizedTitle(value: unknown, locale: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const candidate = object[locale] ?? object.vi ?? object.en;
    return typeof candidate === 'string' ? candidate : '';
  }
  return '';
}

import 'server-only';

import { contentStage, type ContentStage } from '@/features/content-review/lifecycle';
import { isStatusValue, type ReviewStatus } from '@/features/staff-ui/components/status-tones';
import { listCourses } from '@/features/studio/drafts';
import type { Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

/** One row of /studio/courses; plain serializable data so a harness can render the view with fixtures. */
export type CourseRow = {
  id: string;
  status: 'draft' | 'published' | 'archived';
  /** Status of the course's latest review request; null when it has none (or reviews could not be read). */
  reviewStatus: ReviewStatus | null;
  /** Lifecycle stage: an open review decides it, otherwise the content status. */
  stage: ContentStage;
  title: string | null;
  version: number | null;
  updatedAt: string | null;
  owner: string | null;
};

export type CoursesData = {
  /** Every course the scope can read (the whole list is loaded, so totals are honest). */
  rows: CourseRow[];
  /** 'unavailable' when review requests could not be read; stages then follow the content status only. */
  reviews: 'ready' | 'unavailable';
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function localizedTitle(manifest: unknown, locale: string): string | null {
  const title = record(manifest)?.title;
  if (typeof title === 'string') return title;
  const values = record(title);
  return stringValue(values?.[locale]) ?? stringValue(values?.vi) ?? stringValue(values?.en);
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  return (Array.isArray(data) ? data : []).flatMap((value) => {
    const row = record(value);
    return row ? [row] : [];
  });
}

/**
 * Review history rows read for the course list. PostgREST silently caps responses (max_rows), so
 * the read is bounded explicitly, newest first: a response that fills the limit may be missing a
 * course's latest request, and review states are then reported unavailable rather than guessed.
 */
export const COURSE_REVIEW_READ_LIMIT = 1000;

/** Latest review request per course, by submission time (ties keep the first row returned). */
function latestReviewStatuses(data: unknown): Map<string, ReviewStatus> {
  const latest = new Map<string, { at: string; status: ReviewStatus }>();
  for (const row of rowsOf(data)) {
    const courseId = stringValue(row.content_id);
    const status = stringValue(row.status);
    if (!courseId || !status || !isStatusValue('review', status)) continue;
    const at = stringValue(row.submitted_at) ?? '';
    const current = latest.get(courseId);
    if (!current || at > current.at) latest.set(courseId, { at, status });
  }
  return new Map([...latest].map(([courseId, { status }]) => [courseId, status]));
}

/**
 * Every read behind /studio/courses: the scoped course list, then one query per related table
 * (drafts for titles, owners, current versions, review requests for the review state).
 * Metadata failures throw (the page error boundary shows it); a failed review read only marks
 * review states unavailable, so the list still renders with content statuses.
 */
export async function loadStudioCourses(locale: string, scope: Scope): Promise<CoursesData> {
  const database = supabaseService();
  const courses = await listCourses(undefined, scope);

  const baseRows = courses.flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const id = stringValue(row.id);
    const rawStatus = stringValue(row.status);
    if (!id || (rawStatus !== 'draft' && rawStatus !== 'published' && rawStatus !== 'archived')) return [];
    const status: CourseRow['status'] = rawStatus;
    return [{
      id,
      status,
      ownerId: stringValue(row.owner_id),
      currentVersionId: stringValue(row.current_version_id),
      updatedAt: stringValue(row.updated_at),
    }];
  });
  if (baseRows.length === 0) return { rows: [], reviews: 'ready' };

  const courseIds = baseRows.map(({ id }) => id);
  const ownerIds = [...new Set(baseRows.flatMap(({ ownerId }) => ownerId ? [ownerId] : []))];
  const versionIds = [...new Set(baseRows.flatMap(({ currentVersionId }) => currentVersionId ? [currentVersionId] : []))];
  const [draftsResult, ownersResult, versionsResult, reviewsResult] = await Promise.all([
    database.from('course_drafts').select('course_id,manifest,updated_at').in('course_id', courseIds),
    database.from('profiles').select('id,display_name').in('id', ownerIds),
    database.from('course_versions').select('id,version').in('id', versionIds),
    Promise.resolve(
      database.from('cms_review_requests').select('content_id,status,submitted_at').eq('content_type', 'course').in('content_id', courseIds)
        .order('submitted_at', { ascending: false }).limit(COURSE_REVIEW_READ_LIMIT),
    ).then((result) => result, (error: unknown) => ({ data: null, error })),
  ]);
  if (draftsResult.error || ownersResult.error || versionsResult.error) throw new Error('Course metadata could not be loaded');

  const drafts = new Map(rowsOf(draftsResult.data).flatMap((row) => typeof row.course_id === 'string' ? [[row.course_id, row] as const] : []));
  const owners = new Map(rowsOf(ownersResult.data).flatMap((row) => typeof row.id === 'string' ? [[row.id, stringValue(row.display_name)] as const] : []));
  const versions = new Map(rowsOf(versionsResult.data).flatMap((row) => typeof row.id === 'string' && typeof row.version === 'number' ? [[row.id, row.version] as const] : []));
  const reviews: CoursesData['reviews'] = reviewsResult.error || rowsOf(reviewsResult.data).length >= COURSE_REVIEW_READ_LIMIT ? 'unavailable' : 'ready';
  const reviewStatuses = reviews === 'ready' ? latestReviewStatuses(reviewsResult.data) : new Map<string, ReviewStatus>();

  const rows = baseRows.map(({ id, status, ownerId, currentVersionId, updatedAt }): CourseRow => {
    const reviewStatus = reviewStatuses.get(id) ?? null;
    return {
      id,
      status,
      reviewStatus,
      stage: contentStage({ reviewStatus, contentStatus: status }),
      title: localizedTitle(drafts.get(id)?.manifest, locale),
      version: currentVersionId ? versions.get(currentVersionId) ?? null : null,
      updatedAt: stringValue(drafts.get(id)?.updated_at) ?? updatedAt,
      owner: ownerId ? owners.get(ownerId) ?? ownerId : null,
    };
  }).sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  return { rows, reviews };
}

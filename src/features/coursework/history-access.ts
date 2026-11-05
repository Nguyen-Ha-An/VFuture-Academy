import 'server-only';

import { resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import { recordOf, recordsOf, type LearnerDatabase } from '@/features/learning/shared';
import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';

export function historyNotFound(): never {
  throw new ApiError(404, 'HISTORY_NOT_FOUND', 'The selected learning record was not found');
}
export function historyDatabaseError(error: unknown): void {
  if (error) throw new ApiError(503, 'HISTORY_UNAVAILABLE', 'Historical learning records could not be loaded');
}

/** The record supplies the immutable version and school; the URL supplies no authority. */
export async function readHistoricalContext(database: LearnerDatabase, actor: Actor, row: Record<string, unknown> | null,
  locator: { id: string; courseId: string; itemId: string }, locale: Locale) {
  if (!row || row.id !== locator.id || row.user_id !== actor.userId || row.item_id !== locator.itemId
    || typeof row.course_version_id !== 'string') historyNotFound();
  const versionId = row.course_version_id;
  const version = await database.from('course_versions').select('course_id').eq('id', versionId).maybeSingle();
  historyDatabaseError(version.error);
  if (recordOf(version.data)?.course_id !== locator.courseId) historyNotFound();
  const enrollment = await database.from('enrollments').select('course_version_id,status')
    .eq('user_id', actor.userId).eq('course_id', locator.courseId).in('status', ['active', 'completed']).maybeSingle();
  historyDatabaseError(enrollment.error);
  const ownedEnrollment = recordOf(enrollment.data);
  if (typeof ownedEnrollment?.course_version_id !== 'string'
    || (ownedEnrollment.status !== undefined && !['active', 'completed'].includes(String(ownedEnrollment.status)))) historyNotFound();
  await assertEnrollmentMembershipAccess(actor, row, database);
  const [outlineResult, itemResult] = await Promise.all([
    database.from('course_version_outline').select('version_id,course_id,meta,default_language')
      .eq('version_id', versionId).eq('course_id', locator.courseId).maybeSingle(),
    database.from('course_version_items').select('item_id,kind,grading').eq('version_id', versionId)
      .eq('item_id', locator.itemId).maybeSingle(),
  ]);
  historyDatabaseError(outlineResult.error); historyDatabaseError(itemResult.error);
  const outline = recordOf(outlineResult.data), item = recordOf(itemResult.data);
  if (!outline || outline.version_id !== versionId || outline.course_id !== locator.courseId
    || !item || item.item_id !== locator.itemId) historyNotFound();
  const defaultLocale: Locale = outline.default_language === 'en' ? 'en' : 'vi';
  const renders = await database.from('course_version_item_renders').select('locale,payload')
    .eq('version_id', versionId).eq('item_id', locator.itemId).in('locale', [...new Set([locale, defaultLocale])]);
  historyDatabaseError(renders.error);
  const renderRows = recordsOf(renders.data);
  const renderRow = renderRows.find((candidate) => candidate.locale === locale)
    ?? renderRows.find((candidate) => candidate.locale === defaultLocale);
  const render = recordOf(renderRow?.payload);
  if (!render || render.id !== locator.itemId || render.kind !== item.kind) historyNotFound();
  const title = recordOf(outline.meta)?.title;
  const courseTitle = typeof title === 'string' ? title
    : recordOf(title) ? resolveL10nString(title as L10nString, locale, defaultLocale) : '';
  return { courseId: locator.courseId, courseVersionId: versionId, itemId: locator.itemId,
    branchId: row.branch_scope_known === true && typeof row.branch_id === 'string' ? row.branch_id : null,
    locale: renderRow!.locale as Locale, courseTitle, defaultLocale, item, render };
}

/** Finds a localized block in the immutable item, including supported nested containers. */
export function historicalBlock(value: unknown, id: string, type: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) { const found = historicalBlock(child, id, type); if (found) return found; }
    return null;
  }
  const row = recordOf(value);
  if (!row) return null;
  if (row.id === id && row.type === type) return row;
  for (const field of ['blocks', 'items', 'steps']) {
    const found = historicalBlock(row[field], id, type);
    if (found) return found;
  }
  return null;
}

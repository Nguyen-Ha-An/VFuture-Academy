import type { Actor } from '@/lib/permissions';
import type { CourseDraft } from '@/features/studio/drafts';

import { assertMcpCourseAccess, canMcpEditCourse } from '../authz/course-access';
import { mcpGetDraft, type ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { outlineFromDraft, ownerScopeKey, record, type OutlineSelection } from './courses';

export type ReadCourseState = {
  draft: CourseDraft;
  ownerScopeKey: string;
  canEdit: boolean;
  reviewPending: boolean;
};

export async function isCourseReviewPending(db: ReadOnlyDatabase, courseId: string): Promise<boolean> {
  const { data, error } = await db.from('cms_review_requests')
    .select('id')
    .eq('content_type', 'course')
    .eq('content_id', courseId)
    .eq('status', 'pending')
    .limit(1);
  if (error || !Array.isArray(data)) throw new StudioMcpError('SERVICE_UNAVAILABLE');
  return data.length > 0;
}

/** Access is checked against the live owner before any service-role row read. */
export async function readCourseState(
  db: ReadOnlyDatabase,
  actor: Actor,
  courseId: string,
  includeReviewPending = false,
): Promise<ReadCourseState> {
  await assertMcpCourseAccess(db, actor, courseId, 'content.read');
  const { data, error } = await db.from('courses')
    .select('id,ownership_kind,owner_branch_id')
    .eq('id', courseId)
    .maybeSingle();
  const course = record(data);
  if (error || !course) throw new StudioMcpError('COURSE_NOT_FOUND_OR_FORBIDDEN');
  const [draft, canEdit, reviewPending] = await Promise.all([
    mcpGetDraft(db, courseId),
    canMcpEditCourse(db, actor, courseId),
    includeReviewPending ? isCourseReviewPending(db, courseId) : Promise.resolve(false),
  ]);
  return { draft, canEdit, reviewPending, ownerScopeKey: ownerScopeKey(course) };
}

export async function mcpGetCourseOutline(
  db: ReadOnlyDatabase,
  actor: Actor,
  courseId: string,
  resourceOrigin: string,
  selection: OutlineSelection = {},
) {
  const state = await readCourseState(db, actor, courseId, true);
  const outline = await outlineFromDraft(state.draft, state.canEdit, selection);
  if ((selection.itemId || selection.moduleId) && outline.modules.length === 0) {
    throw new StudioMcpError('ITEM_NOT_FOUND');
  }
  return {
    courseId,
    ...outline,
    ownerScopeKey: state.ownerScopeKey,
    canEdit: state.canEdit,
    reviewPending: state.reviewPending,
    studioUrl: `${resourceOrigin}/studio/courses/${courseId}`,
  };
}

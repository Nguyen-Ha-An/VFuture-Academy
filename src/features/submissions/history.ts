import 'server-only';

import type { Locale } from '@/content-engine';
import { historicalBlock, historyDatabaseError, historyNotFound, readHistoricalContext } from '@/features/coursework/history-access';
import { recordOf, type LearnerDatabase } from '@/features/learning/shared';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { parseLearnerAssignmentSubmission } from './service';

export type AssignmentHistoryLocator = { courseId: string; itemId: string; submissionId: string };

export function createAssignmentHistoryReader(database: LearnerDatabase) {
  return { async read(actor: Actor, locator: AssignmentHistoryLocator, locale: Locale) {
    const result = await database.from('assignment_submissions')
      .select('id,user_id,course_version_id,item_id,block_id,branch_id,branch_scope_known,attempt_no,payload,status,submitted_at,due_at_snapshot,late,submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)')
      .eq('id', locator.submissionId).eq('user_id', actor.userId).maybeSingle();
    historyDatabaseError(result.error);
    const row = recordOf(result.data);
    const context = await readHistoricalContext(database, actor, row, { ...locator, id: locator.submissionId }, locale);
    const blockId = typeof row!.block_id === 'string' ? row!.block_id : null;
    const assignment = context.item.kind === 'assignment' && blockId === null ? context.render
      : context.item.kind === 'lesson' && blockId ? historicalBlock(context.render.blocks, blockId, 'assignment') : null;
    if (!assignment) historyNotFound();
    const submission = parseLearnerAssignmentSubmission(row);
    if (!submission) historyNotFound();
    return { courseId: context.courseId, courseVersionId: context.courseVersionId, itemId: context.itemId,
      branchId: context.branchId, blockId, locale: context.locale, courseTitle: context.courseTitle, assignment, submission };
  } };
}
export type AssignmentHistoricalReview = Awaited<ReturnType<ReturnType<typeof createAssignmentHistoryReader>['read']>>;
export const getAssignmentHistoricalReview = (actor: Actor, locator: AssignmentHistoryLocator, locale: Locale) =>
  createAssignmentHistoryReader(supabaseService() as unknown as LearnerDatabase).read(actor, locator, locale);

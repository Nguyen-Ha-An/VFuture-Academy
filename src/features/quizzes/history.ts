import 'server-only';

import { type Locale, type QuestionResult } from '@/content-engine';
import { learnerQuestionResult } from '@/content-engine/grading/learner-result';
import { historicalBlock, historyDatabaseError, historyNotFound, readHistoricalContext } from '@/features/coursework/history-access';
import { recordOf, recordsOf, type LearnerDatabase } from '@/features/learning/shared';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

export type QuizHistoryLocator = { courseId: string; itemId: string; attemptId: string };

function recordedResults(value: unknown, reveal: boolean): QuestionResult[] {
  return recordsOf(value).flatMap((row): QuestionResult[] => {
    if (typeof row.questionId !== 'string' || !['correct', 'incorrect', 'partial', 'incomplete', 'pending_manual', 'self_assessed'].includes(String(row.status))
      || typeof row.points !== 'number' || !Number.isFinite(row.points) || typeof row.maxPoints !== 'number' || !Number.isFinite(row.maxPoints)) return [];
    const parts = recordOf(row.parts);
    const result: QuestionResult = { questionId: row.questionId, status: row.status as QuestionResult['status'], points: row.points, maxPoints: row.maxPoints,
      ...(reveal && parts ? { parts: Object.fromEntries(Object.entries(parts).filter(([, status]) => ['correct', 'incorrect', 'missing'].includes(String(status)))) as NonNullable<QuestionResult['parts']> } : {}),
      ...(Array.isArray(row.children) ? { children: recordedResults(row.children, reveal) } : {}) };
    return [learnerQuestionResult(result, reveal)];
  });
}
function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function createQuizHistoryReader(database: LearnerDatabase) {
  return { async read(actor: Actor, locator: QuizHistoryLocator, locale: Locale) {
    const result = await database.from('quiz_attempts')
      .select('id,user_id,course_version_id,item_id,quiz_id,branch_id,branch_scope_known,attempt_no,answers,results,points,max_points,percent,passed,submitted_at')
      .eq('id', locator.attemptId).eq('user_id', actor.userId).maybeSingle();
    historyDatabaseError(result.error);
    const row = recordOf(result.data);
    const context = await readHistoricalContext(database, actor, row, { ...locator, id: locator.attemptId }, locale);
    const blockId = typeof row!.quiz_id === 'string' ? row!.quiz_id : null;
    const definition = blockId ? recordOf(recordOf(context.item.grading)?.quizzes)?.[blockId] : null;
    const quiz = context.item.kind === 'lesson' && blockId ? historicalBlock(context.render.blocks, blockId, 'quiz') : null;
    const points = number(row!.points), maxPoints = number(row!.max_points), percent = number(row!.percent);
    if (!blockId || !recordOf(definition) || !quiz || points === null || maxPoints === null || percent === null
      || !Number.isSafeInteger(row!.attempt_no) || typeof row!.submitted_at !== 'string') historyNotFound();
    const feedback = recordOf(definition)?.feedback;
    const reveal = feedback === 'per_question' || feedback === 'after_submit';
    return { courseId: context.courseId, courseVersionId: context.courseVersionId, itemId: context.itemId,
      branchId: context.branchId, blockId, locale: context.locale, courseTitle: context.courseTitle, quiz,
      attempt: { attemptId: locator.attemptId, attemptNo: row!.attempt_no as number, submittedAt: row!.submitted_at as string,
        answers: recordOf(row!.answers) ?? {}, results: recordedResults(row!.results, reveal), points, maxPoints, percent,
        passed: typeof row!.passed === 'boolean' ? row!.passed : null } };
  } };
}
export type QuizHistoricalReview = Awaited<ReturnType<ReturnType<typeof createQuizHistoryReader>['read']>>;
export const getQuizHistoricalReview = (actor: Actor, locator: QuizHistoryLocator, locale: Locale) =>
  createQuizHistoryReader(supabaseService() as unknown as LearnerDatabase).read(actor, locator, locale);

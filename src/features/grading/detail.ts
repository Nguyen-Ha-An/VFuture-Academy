import 'server-only';

import type { AssignmentGradingSettings, GradingItem } from '@/content-engine/compile';
import type { Locale } from '@/content-engine/schema/common';
import type { Rubric } from '@/content-engine/schema/questions/base';
import type { ExamAnswerRecord, ExamAttemptRecord } from '@/features/exams/types';
import {
  parseAssignmentGradingSettings,
  parseSubmissionGradingItem,
  parseSubmissionQueueSubmission,
  encodeQueueCursor,
  queue as readSubmissionQueue,
} from '@/features/submissions/service';
import type { SubmissionQueueFilter, SubmissionQueuePage, SubmissionQueueSubmission } from '@/features/submissions/contracts';
import { safeInternalHref } from '@/features/instructor-grading/safe-url';
import { routes } from '@/lib/routes';
import { localizeOutlineTitle, versionTitles } from './titles';
import { canGradeSubmissionBranch } from '@/features/submissions/permissions';
import { ApiError } from '@/lib/api';
import { can, hasGlobalPermission, type Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { SupabaseExamRepo, type ExamDatabase } from '@/features/exams/supabase-repo';

type AssignmentSource = {
  courseId: string;
  courseVersionId: string;
  courseVersion: number;
  publishedAt: string;
  itemId: string;
  grading: GradingItem;
  defaultLocale: Locale;
  renders: Partial<Record<Locale, unknown>>;
};

export type AssignmentGradingDetail = {
  kind: 'assignment';
  submission: SubmissionQueueSubmission;
  source: {
    courseId: string;
    courseVersionId: string;
    courseVersion: number;
    publishedAt: string;
    itemId: string;
    assignmentId: string;
    locale: Locale;
    availableLocales: Locale[];
    prompt: unknown;
    rubric: Rubric | null;
    settings: AssignmentGradingSettings;
  };
};

export type ExamGradingQuestion = {
  questionId: string;
  sectionId: string;
  context?: unknown;
  order: number;
  type: string;
  prompt: unknown;
  grading: unknown;
  answer: unknown;
  result: ExamAnswerRecord['result'];
  manualPoints: number | null;
  manualFeedback: unknown | null;
  gradedBy: string | null;
  updatedAt: string | null;
};

/**
 * The server-computed completion gate. The workbench enables its completion control
 * from `complete` rather than re-deriving it, so the button and the endpoint that
 * backs it agree on one definition of "fully graded".
 */
export type ExamManualGradingProgress = {
  /** Manual questions in this attempt, including question-group children. */
  total: number;
  /** Manual questions that already carry a valid stored score. */
  scored: number;
  /** Question ids still unscored, in attempt order, for the workbench to highlight. */
  outstanding: string[];
  /** True when completing grading will be accepted. */
  complete: boolean;
};

export type ExamGradingDetail = {
  kind: 'exam';
  learnerName: string;
  attempt: {
    attemptId: string;
    userId: string;
    courseVersionId: string;
    itemId: string;
    branchId: string | null;
    attemptNo: number;
    status: ExamAttemptRecord['status'];
    late: boolean;
    startedAt: string;
    deadlineAt: string | null;
    submittedAt: string | null;
    points: number | null;
    maxPoints: number | null;
    percent: number | null;
    /** Answer-key release. Never set by completing grading. */
    releasedAt: string | null;
    /** Grading completion. Never set by releasing an answer key. */
    resultAvailableAt: string | null;
    integrityEventCount: number;
  };
  manualGrading: ExamManualGradingProgress;
  source: {
    locale: Locale;
    defaultLocale: Locale;
    sections: ExamAttemptRecord['questionSet']['sections'];
    learner: ExamAttemptRecord['questionSet']['learner'];
    gradingSnapshot: GradingItem;
  };
  questions: ExamGradingQuestion[];
};

export interface GradingDetailRepository {
  getAssignmentSubmission(id: string): Promise<SubmissionQueueSubmission | null>;
  getAssignmentSource(courseVersionId: string, itemId: string): Promise<AssignmentSource | null>;
  getExamAttempt(id: string): Promise<{
    attempt: ExamAttemptRecord;
    learnerName: string;
    integrityEventCount: number;
  } | null>;
  getExamAnswers(attemptId: string): Promise<ExamAnswerRecord[]>;
}

function historicalSourceUnavailable(): never {
  throw new ApiError(
    409,
    'HISTORICAL_SOURCE_UNAVAILABLE',
    'The pinned published source for this grading record is unavailable',
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findNode(value: unknown, id: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNode(entry, id);
      if (found) return found;
    }
    return null;
  }
  const node = record(value);
  if (!node) return null;
  if (node.id === id) return node;
  for (const entry of Object.values(node)) {
    const found = findNode(entry, id);
    if (found) return found;
  }
  return null;
}

function canViewExam(actor: Actor, branchId: string | null): boolean {
  if (branchId === null) {
    return hasGlobalPermission(actor, 'submission.grade');
  }
  const scope = { kind: 'branch' as const, branchId };
  return can(actor, 'submission.grade', scope);
}

function assertRequestedBranch(actual: string | null, requested: string | undefined): void {
  if (requested !== undefined && actual !== requested) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
}

function assignmentDetail(
  submission: SubmissionQueueSubmission,
  source: AssignmentSource,
  preferredLocale: Locale,
): AssignmentGradingDetail {
  if (source.courseVersionId !== submission.courseVersionId || source.itemId !== submission.itemId) {
    historicalSourceUnavailable();
  }
  const settings = parseAssignmentGradingSettings(source.grading.assignments?.[submission.assignmentId]);
  const rubric = source.grading.rubrics[submission.assignmentId] ?? null;
  const availableLocales = (['vi', 'en'] as const).filter((locale) => source.renders[locale] !== undefined);
  const locale = source.renders[preferredLocale] !== undefined
    ? preferredLocale
    : source.renders[source.defaultLocale] !== undefined
      ? source.defaultLocale
      : availableLocales[0];
  if (!settings || !locale) historicalSourceUnavailable();
  const prompt = findNode(source.renders[locale], submission.assignmentId);
  if (!prompt) historicalSourceUnavailable();
  return {
    kind: 'assignment',
    submission,
    source: {
      courseId: source.courseId,
      courseVersionId: source.courseVersionId,
      courseVersion: source.courseVersion,
      publishedAt: source.publishedAt,
      itemId: source.itemId,
      assignmentId: submission.assignmentId,
      locale,
      availableLocales,
      prompt: structuredClone(prompt),
      rubric: rubric ? structuredClone(rubric) : null,
      settings: structuredClone(settings),
    },
  };
}

function manualGradingProgress(
  questions: readonly ExamGradingQuestion[],
): ExamManualGradingProgress {
  // A manual question is one the grader owns: it either still reports
  // `pending_manual` from automatic grading, or it already carries a manual score.
  const manual = questions.filter((question) =>
    question.result?.status === 'pending_manual' || question.manualPoints !== null);
  const outstanding = manual
    .filter((question) => question.manualPoints === null || question.result === null)
    .map((question) => question.questionId);
  return {
    total: manual.length,
    scored: manual.length - outstanding.length,
    outstanding,
    complete: manual.length > 0 && outstanding.length === 0,
  };
}

function examDetail(
  entry: NonNullable<Awaited<ReturnType<GradingDetailRepository['getExamAttempt']>>>,
  answers: ExamAnswerRecord[],
): ExamGradingDetail {
  const { attempt } = entry;
  if (!attempt.questionSet?.sections?.length || !attempt.questionSet.learner
    || !attempt.gradingSnapshot?.questions) historicalSourceUnavailable();
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  function lineageFor(questionId:string):string[] {
    const lineage=[questionId];let cursor=attempt.gradingSnapshot.questions[questionId];
    while(cursor?.parentId&&!lineage.includes(cursor.parentId)){lineage.unshift(cursor.parentId);cursor=attempt.gradingSnapshot.questions[cursor.parentId];}
    return lineage;
  }
  function descendants(questionId:string,visited=new Set<string>()):string[] {
    if(visited.has(questionId))return [];visited.add(questionId);
    return [questionId,...(attempt.gradingSnapshot.questions[questionId]?.children??[]).flatMap(child=>descendants(child.id,visited))];
  }
  function nestedResult(result:ExamAnswerRecord['result'],id:string):ExamAnswerRecord['result'] {
    if(!result)return null;if(result.questionId===id)return result;
    for(const child of result.children??[]){const found=nestedResult(child,id);if(found)return found;}return null;
  }
  const questions = attempt.questionSet.sections.flatMap((section) =>
    section.questionIds.flatMap(id=>descendants(id)).map((questionId, order): ExamGradingQuestion => {
      const grading = attempt.gradingSnapshot.questions[questionId];
      const prompt = findNode(attempt.questionSet.learner, questionId);
      if (!grading || !prompt) historicalSourceUnavailable();
      const lineage=lineageFor(questionId);
      const top=byQuestion.get(lineage[0]);const answer=byQuestion.get(questionId);
      let value=top?.answer??null;
      for(const childId of lineage.slice(1))value=record(value)?.[childId]??null;
      const contextBlocks=lineage.slice(0,-1).flatMap(id=>{
        const shared=record(findNode(attempt.questionSet.learner,id)?.sharedContent);
        return Array.isArray(shared?.blocks)?shared.blocks:[];
      });
      return {
        questionId, sectionId: section.id, order,
        ...(contextBlocks.length?{context:{blocks:structuredClone(contextBlocks)}}:{}),
        type: typeof prompt.type === 'string' ? prompt.type : grading.type,
        prompt: structuredClone(prompt), grading: structuredClone(grading),
        answer: structuredClone(answer?.answer??value),
        result: structuredClone(answer?.result??nestedResult(top?.result??null,questionId)),
        manualPoints: answer?.manualPoints ?? null,
        manualFeedback: answer?.manualFeedback ? structuredClone(answer.manualFeedback) : null,
        gradedBy: answer?.gradedBy ?? null,
        updatedAt: answer?.updatedAt.toISOString() ?? null,
      };
    }));
  return {
    kind: 'exam',
    learnerName: entry.learnerName,
    attempt: {
      attemptId: attempt.id,
      userId: attempt.userId,
      courseVersionId: attempt.courseVersionId,
      itemId: attempt.itemId,
      branchId: attempt.branchId,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      late: attempt.late,
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      points: attempt.points,
      maxPoints: attempt.maxPoints,
      percent: attempt.percent,
      releasedAt: attempt.releasedAt?.toISOString() ?? null,
      resultAvailableAt: attempt.resultAvailableAt?.toISOString() ?? null,
      integrityEventCount: entry.integrityEventCount,
    },
    manualGrading: manualGradingProgress(questions),
    source: {
      locale: attempt.questionSet.locale,
      defaultLocale: attempt.questionSet.defaultLocale,
      sections: structuredClone(attempt.questionSet.sections),
      learner: structuredClone(attempt.questionSet.learner),
      gradingSnapshot: structuredClone(attempt.gradingSnapshot),
    },
    questions,
  };
}

export function createGradingDetailService(repository: GradingDetailRepository) {
  return {
    async assignment(actor: Actor, submissionId: string, requestedBranch: string | undefined, locale: Locale) {
      const submission = await repository.getAssignmentSubmission(submissionId);
      if (!submission) throw new ApiError(404, 'SUBMISSION_NOT_FOUND', 'Assignment submission not found');
      assertRequestedBranch(submission.branchId, requestedBranch);
      if (!canGradeSubmissionBranch(actor, submission.branchId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      const source = await repository.getAssignmentSource(submission.courseVersionId, submission.itemId);
      if (!source) historicalSourceUnavailable();
      return assignmentDetail(submission, source, locale);
    },

    async exam(actor: Actor, attemptId: string, requestedBranch: string | undefined) {
      const entry = await repository.getExamAttempt(attemptId);
      if (!entry) throw new ApiError(404, 'EXAM_ATTEMPT_NOT_FOUND', 'Exam attempt not found');
      assertRequestedBranch(entry.attempt.branchId, requestedBranch);
      if (!canViewExam(actor, entry.attempt.branchId)) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      return examDetail(entry, await repository.getExamAnswers(attemptId));
    },
  };
}

type QueryResult = { data: unknown; error: unknown | null; count?: number | null };
type Query = PromiseLike<QueryResult> & {
  select(columns: string, options?: unknown): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: unknown): Query;
  maybeSingle(): Promise<QueryResult>;
};
type Database = { from(table: string): Query };

function queryData(result: QueryResult, operation: string): unknown {
  if (result.error) throw new ApiError(500, 'GRADING_DATABASE_ERROR', `Unable to ${operation}`);
  return result.data;
}

function profileName(value: unknown, fallback: string): string {
  const profile = Array.isArray(value) ? record(value[0]) : record(value);
  if (typeof profile?.display_name === 'string' && profile.display_name) return profile.display_name;
  if (typeof profile?.handle === 'string' && profile.handle) return `@${profile.handle}`;
  return fallback;
}

export function createSupabaseGradingDetailRepository(
  client = supabaseService() as unknown as Database,
): GradingDetailRepository {
  const examRepo = new SupabaseExamRepo(client as unknown as ExamDatabase);
  return {
    async getAssignmentSubmission(id) {
      const result = await client.from('assignment_submissions')
        .select('id,user_id,course_version_id,item_id,block_id,attempt_no,payload,status,submitted_at,branch_id,branch_scope_known,profiles!inner(display_name,handle),submission_files(asset_id,name,size_bytes,mime),grades(rubric_scores,total_points,max_points,feedback,decision,passed,graded_at,released)')
        .eq('id', id)
        .maybeSingle();
      const value = queryData(result, 'load assignment submission');
      return value ? parseSubmissionQueueSubmission(value) : null;
    },
    async getAssignmentSource(courseVersionId, itemId) {
      const [versionResult, itemResult, renderResult, outlineResult] = await Promise.all([
        client.from('course_versions').select('id,course_id,version,published_at').eq('id', courseVersionId).maybeSingle(),
        client.from('course_version_items').select('version_id,item_id,kind,grading').eq('version_id', courseVersionId).eq('item_id', itemId).maybeSingle(),
        client.from('course_version_item_renders').select('locale,payload').eq('version_id', courseVersionId).eq('item_id', itemId).order('locale'),
        client.from('course_version_outline').select('default_language').eq('version_id', courseVersionId).maybeSingle(),
      ]);
      const version = record(queryData(versionResult, 'load pinned course version'));
      const item = record(queryData(itemResult, 'load pinned assignment'));
      const renderRows = queryData(renderResult, 'load pinned assignment renders');
      const outline = record(queryData(outlineResult, 'load pinned course locale'));
      const grading = parseSubmissionGradingItem(item?.grading);
      if (!version || !item || item.kind !== 'assignment' && item.kind !== 'lesson' || !grading
        || typeof version.course_id !== 'string' || typeof version.version !== 'number'
        || typeof version.published_at !== 'string') return null;
      const renders: Partial<Record<Locale, unknown>> = {};
      for (const value of Array.isArray(renderRows) ? renderRows : []) {
        const row = record(value);
        if (row?.locale === 'vi' || row?.locale === 'en') renders[row.locale] = row.payload;
      }
      return {
        courseId: version.course_id,
        courseVersionId,
        courseVersion: version.version,
        publishedAt: version.published_at,
        itemId,
        grading,
        defaultLocale: outline?.default_language === 'en' ? 'en' : 'vi',
        renders,
      };
    },
    async getExamAttempt(id) {
      const attempt = await examRepo.getAttempt(id);
      if (!attempt) return null;
      const [profileResult, eventsResult] = await Promise.all([
        client.from('profiles').select('display_name,handle').eq('id', attempt.userId).maybeSingle(),
        client.from('exam_attempt_events').select('id', { count: 'exact', head: true }).eq('attempt_id', id),
      ]);
      const profile = queryData(profileResult, 'load exam learner');
      queryData(eventsResult, 'count exam integrity events');
      return {
        attempt,
        learnerName: profileName(profile, attempt.userId),
        integrityEventCount: eventsResult.count ?? 0,
      };
    },
    getExamAnswers(attemptId) {
      return examRepo.listAnswers(attemptId);
    },
  };
}

export function createServerGradingDetailService() {
  return createGradingDetailService(createSupabaseGradingDetailRepository());
}

// ---------------------------------------------------------------------------------------------
// Workbench header context (PR 10): resolved titles and the server-computed "Next in queue" link.
// The workbench page reads it here, through one mockable entry point, and passes plain data to
// the client workbench. Every part settles on its own and nothing here throws: a failed read
// leaves `titles` or `nextHref` null and the workbench simply omits them.
// ---------------------------------------------------------------------------------------------

/** Localized titles for the workbench header; null parts fall back to what the detail carries. */
export type WorkbenchTitles = { course: string | null; item: string | null };

export type GradingWorkbenchContext = {
  titles: WorkbenchTitles | null;
  /** The next oldest waiting record after this one within the same filters and scope. */
  nextHref: string | null;
};

type WorkbenchQueryResult = { data: unknown; error: unknown };
export interface WorkbenchQuery extends PromiseLike<WorkbenchQueryResult> {
  select(columns: string): WorkbenchQuery;
  eq(column: string, value: unknown): WorkbenchQuery;
  is(column: string, value: null): WorkbenchQuery;
  or(filters: string): WorkbenchQuery;
  order(column: string, options?: { ascending?: boolean }): WorkbenchQuery;
  limit(count: number): WorkbenchQuery;
  maybeSingle(): PromiseLike<WorkbenchQueryResult>;
}
export interface WorkbenchDatabase { from(table: string): WorkbenchQuery }

export type GradingWorkbenchContextInput = {
  kind: 'assignments' | 'exams';
  id: string;
  actor: Actor;
  locale: Locale;
  /** The workbench URL's query (filters and `back`), exactly as the page received it. */
  search?: Record<string, string | string[] | undefined>;
  /** The active school when the grader works inside one; the queue then stays in it. */
  scopeBranchId?: string | null;
};

export type GradingWorkbenchContextDependencies = {
  database?: WorkbenchDatabase;
  queue?: (actor: Actor, filter: SubmissionQueueFilter) => Promise<SubmissionQueuePage>;
  titles?: typeof versionTitles;
};

const WORKBENCH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Extra queue pages read while a post-fetch filter leaves a page empty. The Waiting filter is
 * narrowed in the database, so one page almost always answers; this only bounds the rare case.
 */
const NEXT_QUEUE_PAGES = 1;

function searchValue(search: GradingWorkbenchContextInput['search'], key: string): string | undefined {
  const value = search?.[key];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.trim() ? single : undefined;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** The submission queue's own keyset cursor, positioned after this submission. */
function queueCursorAfter(submittedAt: string, id: string): string {
  return encodeQueueCursor({ submittedAt, id });
}

async function workbenchTitles(
  loadTitles: typeof versionTitles,
  courseVersionId: string | null,
  itemId: string | null,
  locale: Locale,
): Promise<WorkbenchTitles | null> {
  if (!courseVersionId) return null;
  try {
    const map = await loadTitles([courseVersionId]);
    const version = map.get(courseVersionId.toLowerCase());
    if (!version) return null;
    const course = localizeOutlineTitle(version.courseTitle, locale);
    const item = itemId ? localizeOutlineTitle(version.items.get(itemId), locale) : null;
    return course || item ? { course, item } : null;
  } catch {
    return null;
  }
}

async function nextAssignmentHref(
  input: GradingWorkbenchContextInput,
  current: { id: string; submittedAt: string | null },
  readQueue: NonNullable<GradingWorkbenchContextDependencies['queue']>,
): Promise<string | null> {
  const back = safeInternalHref(searchValue(input.search, 'back'));
  // The queue filter travels in `back` (the list the grader came from); the workbench's own
  // `branchId` is the record's school, not the filter.
  const backQuery = back && new URL(back, 'http://internal.invalid').pathname.endsWith('/queue')
    ? new URL(back, 'http://internal.invalid').searchParams
    : null;
  const courseId = backQuery?.get('courseId') || searchValue(input.search, 'courseId');
  const assignmentId = backQuery?.get('assignmentId') || searchValue(input.search, 'assignmentId');
  const branchId = backQuery?.get('branchId') || input.scopeBranchId || undefined;
  const filter: SubmissionQueueFilter = {
    status: 'pending',
    ...(branchId ? { branchId } : {}),
    ...(courseId ? { courseId } : {}),
    ...(assignmentId ? { assignmentId } : {}),
  };
  const firstOther = async (cursor?: string): Promise<SubmissionQueueSubmission | null> => {
    let next = cursor;
    for (let page = 0; page <= NEXT_QUEUE_PAGES; page += 1) {
      const result = await readQueue(input.actor, { ...filter, ...(next ? { cursor: next } : {}) });
      const found = result.items.find((item) => item.id !== current.id);
      if (found) return found;
      if (!result.nextCursor) return null;
      next = result.nextCursor;
    }
    return null;
  };
  try {
    const after = current.submittedAt && WORKBENCH_UUID.test(current.id)
      ? await firstOther(queueCursorAfter(current.submittedAt, current.id))
      : null;
    // Nothing waits after this one: go back to the oldest one still waiting (the grader may
    // have skipped it), never to this record itself.
    const next = after ?? await firstOther();
    if (!next) return null;
    return routes.grading.assignment(next.id, {
      ...(next.branchId ? { branchId: next.branchId } : {}),
      ...(courseId ? { courseId } : {}),
      ...(assignmentId ? { assignmentId } : {}),
      ...(searchValue(input.search, 'status') ? { status: searchValue(input.search, 'status') } : {}),
      ...(back ? { back } : {}),
    });
  } catch {
    return null;
  }
}

async function nextExamHref(
  input: GradingWorkbenchContextInput,
  current: { id: string; courseVersionId: string; itemId: string; branchId: string | null; submittedAt: string | null },
  database: WorkbenchDatabase,
): Promise<string | null> {
  const back = safeInternalHref(searchValue(input.search, 'back'));
  const pending = () => {
    let query = database.from('exam_attempts')
      .select('id,branch_id,submitted_at')
      .eq('status', 'pending_manual')
      .eq('course_version_id', current.courseVersionId)
      .eq('item_id', current.itemId);
    query = current.branchId === null
      ? query.is('branch_id', null)
      : query.eq('branch_scope_known', true).eq('branch_id', current.branchId);
    return query;
  };
  const firstOther = async (after: boolean): Promise<Record<string, unknown> | null> => {
    let query = pending();
    if (after && current.submittedAt) {
      query = query.or(`submitted_at.gt.${current.submittedAt},and(submitted_at.eq.${current.submittedAt},id.gt.${current.id})`);
    }
    const result = await query.order('submitted_at', { ascending: true }).order('id', { ascending: true }).limit(2);
    if (result.error || !Array.isArray(result.data)) throw new Error('Next exam attempt read failed');
    return result.data.map(record).find((row) => row && row.id !== current.id) ?? null;
  };
  try {
    const next = (current.submittedAt ? await firstOther(true) : null) ?? await firstOther(false);
    const nextId = nonEmptyText(next?.id);
    if (!nextId) return null;
    return routes.grading.exam(nextId, {
      ...(nonEmptyText(next?.branch_id) ? { branchId: next!.branch_id as string } : {}),
      ...(searchValue(input.search, 'courseId') ? { courseId: searchValue(input.search, 'courseId') } : {}),
      ...(searchValue(input.search, 'exam') ? { exam: searchValue(input.search, 'exam') } : {}),
      ...(back ? { back } : {}),
    });
  } catch {
    return null;
  }
}

/** The record's school as the detail service and queue see it: unknown history means none. */
function recordBranch(row: Record<string, unknown>): string | null {
  return row.branch_scope_known === true ? nonEmptyText(row.branch_id) : null;
}

/** Workbench header data with "Next in queue" still resolving, so the page can stream it. */
export type GradingWorkbenchHeader = {
  titles: WorkbenchTitles | null;
  nextHref: Promise<string | null>;
};

/**
 * Header data for the grading workbench: localized course and item titles (titles.ts) now, and
 * the "Next in queue" link as a promise the page streams in (it never blocks the first render).
 * Reads only what the actor may grade; anything else, or any failure, resolves to nulls so the
 * workbench falls back to the detail it loads itself.
 */
export async function gradingWorkbenchHeader(
  input: GradingWorkbenchContextInput,
  dependencies: GradingWorkbenchContextDependencies = {},
): Promise<GradingWorkbenchHeader> {
  const empty: GradingWorkbenchHeader = { titles: null, nextHref: Promise.resolve(null) };
  const loadTitles = dependencies.titles ?? versionTitles;
  let database: WorkbenchDatabase;
  try {
    database = dependencies.database ?? supabaseService() as unknown as WorkbenchDatabase;
    if (!database) return empty;
  } catch {
    return empty;
  }
  try {
    if (input.kind === 'assignments') {
      const result = await database.from('assignment_submissions')
        .select('id,course_version_id,item_id,submitted_at,branch_id,branch_scope_known')
        .eq('id', input.id)
        .maybeSingle();
      const row = result.error ? null : record(result.data);
      const id = nonEmptyText(row?.id);
      if (!row || !id) return empty;
      if (!canGradeSubmissionBranch(input.actor, recordBranch(row))) return empty;
      // Started before the titles are awaited, so both reads overlap.
      const nextHref = nextAssignmentHref(input, { id, submittedAt: nonEmptyText(row.submitted_at) }, dependencies.queue ?? readSubmissionQueue);
      const titles = await workbenchTitles(loadTitles, nonEmptyText(row.course_version_id), nonEmptyText(row.item_id), input.locale);
      return { titles, nextHref };
    }
    const result = await database.from('exam_attempts')
      .select('id,course_version_id,item_id,branch_id,branch_scope_known,submitted_at')
      .eq('id', input.id)
      .maybeSingle();
    const row = result.error ? null : record(result.data);
    const id = nonEmptyText(row?.id);
    const courseVersionId = nonEmptyText(row?.course_version_id);
    const itemId = nonEmptyText(row?.item_id);
    if (!row || !id || !courseVersionId || !itemId) return empty;
    const branchId = recordBranch(row);
    if (!canViewExam(input.actor, branchId)) return empty;
    const nextHref = nextExamHref(input, { id, courseVersionId, itemId, branchId, submittedAt: nonEmptyText(row.submitted_at) }, database);
    const titles = await workbenchTitles(loadTitles, courseVersionId, itemId, input.locale);
    return { titles, nextHref };
  } catch {
    return empty;
  }
}

/** The same header with "Next in queue" resolved (harnesses and tests). */
export async function gradingWorkbenchContext(
  input: GradingWorkbenchContextInput,
  dependencies: GradingWorkbenchContextDependencies = {},
): Promise<GradingWorkbenchContext> {
  const header = await gradingWorkbenchHeader(input, dependencies);
  return { titles: header.titles, nextHref: await header.nextHref.catch(() => null) };
}

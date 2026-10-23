import 'server-only';

import { supabaseService } from '@/lib/supabase/server';
import { ExamError } from './types';
import type {
  AttemptStatus,
  ExamAnswerRecord,
  ExamAttemptRecord,
  ExamEventRecord,
  ExamGradeRecord,
  ExamRepo,
} from './types';

type DatabaseResult = { data: unknown; error: unknown | null; count?: number | null };

export interface ExamQuery extends PromiseLike<DatabaseResult> {
  select(columns: string, options?: unknown): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  is(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string, options?: unknown): this;
  order(column: string, options?: { ascending?: boolean }): this;
  insert(value: unknown): this;
  update(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  single(): Promise<DatabaseResult>;
  maybeSingle(): Promise<DatabaseResult>;
}

export interface ExamDatabase {
  from(table: string): ExamQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DatabaseResult>;
}

const ATTEMPT_BASE_COLUMNS = [
  'id',
  'user_id',
  'course_version_id',
  'item_id',
  'attempt_no',
  'status',
  'late',
  'question_set',
  'grading_snapshot',
  'started_at',
  'deadline_at',
  'submitted_at',
  'points',
  'max_points',
  'percent',
  'released_at',
  'result_available_at',
  'branch_id',
  'branch_scope_known',
].join(',');
const ATTEMPT_COLUMNS = ATTEMPT_BASE_COLUMNS;
const STUDIO_ATTEMPT_COLUMNS = [
  ATTEMPT_BASE_COLUMNS,
  'profile:profiles!exam_attempts_user_id_fkey!inner(display_name,handle)',
  'integrity_events:exam_attempt_events(count)',
].join(',');

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry): Record<string, unknown>[] => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    })
    : [];
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid exam database row: ${key}`);
  return value;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) throw new Error('Invalid exam database timestamp');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid exam database timestamp');
  return date;
}

function requiredDate(value: unknown): Date {
  const date = nullableDate(value);
  if (!date) throw new Error('Invalid exam database timestamp');
  return date;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error('Invalid exam database number');
  return number;
}

function branchIdOf(row: Record<string, unknown>, fallback: string | null = null): string | null {
  if (row.branch_scope_known === false) return null;
  if (row.branch_scope_known === true) {
    return typeof row.branch_id === 'string' ? row.branch_id : null;
  }
  return fallback;
}

function profileNameOf(row: Record<string, unknown>): string {
  const rawProfile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
  const profile = record(rawProfile);
  if (typeof profile?.display_name === 'string' && profile.display_name) return profile.display_name;
  if (typeof profile?.handle === 'string' && profile.handle) return `@${profile.handle}`;
  return requiredString(row, 'user_id');
}

function relatedCount(row: Record<string, unknown>, key: string): number {
  const raw = Array.isArray(row[key]) ? row[key][0] : row[key];
  return nullableNumber(record(raw)?.count) ?? 0;
}

function toAttempt(value: unknown, branchFallback: string | null = null): ExamAttemptRecord {
  const row = record(value);
  if (!row) throw new Error('Invalid exam attempt database row');
  return {
    id: requiredString(row, 'id'),
    userId: requiredString(row, 'user_id'),
    courseVersionId: requiredString(row, 'course_version_id'),
    itemId: requiredString(row, 'item_id'),
    branchId: branchIdOf(row, branchFallback),
    attemptNo: nullableNumber(row.attempt_no) ?? 0,
    status: requiredString(row, 'status') as AttemptStatus,
    late: row.late === true,
    questionSet: row.question_set as ExamAttemptRecord['questionSet'],
    gradingSnapshot: row.grading_snapshot as ExamAttemptRecord['gradingSnapshot'],
    startedAt: requiredDate(row.started_at),
    deadlineAt: nullableDate(row.deadline_at),
    submittedAt: nullableDate(row.submitted_at),
    points: nullableNumber(row.points),
    maxPoints: nullableNumber(row.max_points),
    percent: nullableNumber(row.percent),
    releasedAt: nullableDate(row.released_at),
    // Every attempt written before migration 20260907092000 reads as null here,
    // which is exactly what keeps historical results on the legacy release path.
    resultAvailableAt: nullableDate(row.result_available_at),
  };
}

function attemptInsert(attempt: ExamAttemptRecord) {
  return {
    id: attempt.id,
    user_id: attempt.userId,
    course_version_id: attempt.courseVersionId,
    item_id: attempt.itemId,
    attempt_no: attempt.attemptNo,
    status: attempt.status,
    late: attempt.late,
    question_set: attempt.questionSet,
    grading_snapshot: attempt.gradingSnapshot,
    started_at: attempt.startedAt.toISOString(),
    deadline_at: attempt.deadlineAt?.toISOString() ?? null,
    submitted_at: attempt.submittedAt?.toISOString() ?? null,
    points: attempt.points,
    max_points: attempt.maxPoints,
    percent: attempt.percent,
    released_at: attempt.releasedAt?.toISOString() ?? null,
    result_available_at: attempt.resultAvailableAt?.toISOString() ?? null,
  };
}

function attemptUpdate(patch: Partial<ExamAttemptRecord>) {
  return {
    ...('status' in patch ? { status: patch.status } : {}),
    ...('late' in patch ? { late: patch.late } : {}),
    ...('questionSet' in patch ? { question_set: patch.questionSet } : {}),
    ...('gradingSnapshot' in patch ? { grading_snapshot: patch.gradingSnapshot } : {}),
    ...('deadlineAt' in patch ? { deadline_at: patch.deadlineAt?.toISOString() ?? null } : {}),
    ...('submittedAt' in patch ? { submitted_at: patch.submittedAt?.toISOString() ?? null } : {}),
    ...('points' in patch ? { points: patch.points } : {}),
    ...('maxPoints' in patch ? { max_points: patch.maxPoints } : {}),
    ...('percent' in patch ? { percent: patch.percent } : {}),
    ...('releasedAt' in patch ? { released_at: patch.releasedAt?.toISOString() ?? null } : {}),
    ...('resultAvailableAt' in patch
      ? { result_available_at: patch.resultAvailableAt?.toISOString() ?? null }
      : {}),
  };
}

function answerRpcRows(answers: readonly ExamAnswerRecord[]) {
  return answers.map((answer) => ({
    questionId: answer.questionId,
    answer: answer.answer,
    result: answer.result,
    manualPoints: answer.manualPoints,
    manualFeedback: answer.manualFeedback,
    gradedBy: answer.gradedBy,
    updatedAt: answer.updatedAt.toISOString(),
  }));
}

function answerValueSnapshot(answers: readonly ExamAnswerRecord[]) {
  return Object.fromEntries(answers.map(({ questionId, answer }) => [questionId, answer]));
}

/**
 * The completion compare-and-set. It carries `manualPoints` beside the answer so a
 * grading draft saved between the caller's read and this write aborts the
 * completion, and it must stay byte-identical to the `jsonb_object_agg` shape built
 * by `exam_complete_manual_grading`.
 */
function answerGradingSnapshot(answers: readonly ExamAnswerRecord[]) {
  return Object.fromEntries(answers.map(({ questionId, answer, manualPoints }) => [
    questionId,
    { answer: answer ?? null, manualPoints },
  ]));
}

function toAnswer(value: unknown): ExamAnswerRecord {
  const row = record(value);
  if (!row) throw new Error('Invalid exam answer database row');
  return {
    attemptId: requiredString(row, 'attempt_id'),
    questionId: requiredString(row, 'question_id'),
    answer: row.answer,
    result: row.result as ExamAnswerRecord['result'],
    manualPoints: nullableNumber(row.manual_points),
    manualFeedback: row.manual_feedback ?? null,
    gradedBy: typeof row.graded_by === 'string' ? row.graded_by : null,
    updatedAt: requiredDate(row.updated_at),
  };
}

function toGrade(value: unknown): ExamGradeRecord {
  const row = record(value);
  if (!row) throw new Error('Invalid exam grade database row');
  return {
    userId: requiredString(row, 'user_id'),
    courseVersionId: requiredString(row, 'course_version_id'),
    itemId: requiredString(row, 'item_id'),
    percent: nullableNumber(row.percent) ?? 0,
    passed: row.passed === true,
    policy: requiredString(row, 'policy') as ExamGradeRecord['policy'],
    computedAt: requiredDate(row.computed_at),
  };
}

function assertDatabase(result: DatabaseResult, operation: string) {
  if (result.error) throw new Error(`Unable to ${operation}`);
  return result.data;
}

export class SupabaseExamRepo implements ExamRepo {
  constructor(
    private readonly database: ExamDatabase = supabaseService() as unknown as ExamDatabase,
  ) {}

  async getAttempt(id: string) {
    const result = await this.database.from('exam_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    const data = assertDatabase(result, 'load exam attempt');
    return data ? toAttempt(data) : null;
  }

  async listAttempts(userId: string | null, itemId: string, courseVersionId?: string) {
    let query = this.database.from('exam_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('item_id', itemId);
    if (userId !== null) query = query.eq('user_id', userId);
    if (courseVersionId !== undefined) query = query.eq('course_version_id', courseVersionId);
    const result = await query.order('attempt_no', { ascending: true });
    return rows(assertDatabase(result, 'list exam attempts')).map((row) => toAttempt(row));
  }

  async listStudioAttempts(
    itemId: string,
    courseVersionId: string,
    branchId: string,
    includeUnassigned: boolean,
  ) {
    let query = this.database.from('exam_attempts')
      .select(STUDIO_ATTEMPT_COLUMNS)
      .eq('item_id', itemId)
      .eq('course_version_id', courseVersionId);
    query = includeUnassigned
      ? query.or(`branch_id.eq.${branchId},branch_id.is.null`)
      : query.eq('branch_scope_known', true).eq('branch_id', branchId);
    const result = await query.order('attempt_no', { ascending: true });
    return rows(assertDatabase(result, 'list studio exam attempts')).map((row) => ({
      attempt: toAttempt(row),
      eventCount: relatedCount(row, 'integrity_events'),
      learnerName: profileNameOf(row),
    }));
  }

  async countUnassignedStudioAttempts(itemId: string, courseVersionId: string) {
    const result = await this.database.from('exam_attempts')
      .select('id,branch_scope_known', { count: 'exact', head: true })
      .eq('item_id', itemId)
      .eq('course_version_id', courseVersionId)
      .eq('branch_scope_known', false);
    assertDatabase(result, 'count unassigned studio exam attempts');
    return result.count ?? 0;
  }

  async insertAttempt(attempt: ExamAttemptRecord, attemptsAllowed: number) {
    const values = attemptInsert(attempt);
    const result = await this.database.rpc('exam_start_attempt', {
      p_id: values.id,
      p_user_id: values.user_id,
      p_course_version_id: values.course_version_id,
      p_item_id: values.item_id,
      p_question_set: values.question_set,
      p_grading_snapshot: values.grading_snapshot,
      p_started_at: values.started_at,
      p_deadline_at: values.deadline_at,
      p_attempts_allowed: attemptsAllowed,
    });
    if (record(result.error)?.code === 'P3001') {
      throw new ExamError('NO_ATTEMPTS', 'No exam attempts remain.');
    }
    const data = assertDatabase(result, 'create exam attempt');
    return toAttempt(Array.isArray(data) ? data[0] : data, attempt.branchId);
  }

  async updateAttempt(id: string, patch: Partial<ExamAttemptRecord>) {
    const result = await this.database.from('exam_attempts')
      .update(attemptUpdate(patch))
      .eq('id', id)
      .select(ATTEMPT_COLUMNS)
      .single();
    return toAttempt(assertDatabase(result, 'update exam attempt'), patch.branchId ?? null);
  }

  async saveActiveAnswers(attemptId: string, userId: string, answers: readonly ExamAnswerRecord[]) {
    const result = await this.database.rpc('exam_save_active_answers', {
      p_attempt_id: attemptId,
      p_user_id: userId,
      p_answers: answerRpcRows(answers),
    });
    const data = assertDatabase(result, 'save active exam answers');
    if (typeof data !== 'boolean') throw new Error('Invalid active answer admission result');
    return data;
  }

  async finalizeAttempt(
    id: string,
    patch: Partial<ExamAttemptRecord>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ) {
    const result = await this.database.rpc('exam_finalize_attempt', {
      p_attempt_id: id,
      p_status: patch.status,
      p_late: patch.late,
      p_submitted_at: patch.submittedAt?.toISOString() ?? null,
      p_points: patch.points,
      p_max_points: patch.maxPoints,
      p_percent: patch.percent,
      p_expected_answers: answerValueSnapshot(expectedAnswers),
      p_answers: answerRpcRows(resultAnswers),
      p_result_available_at: patch.resultAvailableAt?.toISOString() ?? null,
    });
    const data = record(assertDatabase(result, 'finalize exam attempt'));
    if (!data
      || typeof data.transitioned !== 'boolean'
      || typeof data.answersChanged !== 'boolean'
      || !data.attempt) {
      throw new Error('Invalid exam finalization result');
    }
    return {
      attempt: toAttempt(data.attempt, patch.branchId ?? null),
      answersChanged: data.answersChanged,
      transitioned: data.transitioned,
    };
  }

  async saveManualDraft(attemptId: string, answer: ExamAnswerRecord) {
    const result = await this.database.rpc('exam_save_manual_draft', {
      p_attempt_id: attemptId,
      p_answer: answerRpcRows([answer])[0],
    });
    const data = assertDatabase(result, 'save exam manual draft');
    if (typeof data !== 'boolean') throw new Error('Invalid exam manual draft admission result');
    return data;
  }

  async completeManualGrading(
    id: string,
    patch: Pick<ExamAttemptRecord, 'points' | 'maxPoints' | 'percent' | 'resultAvailableAt'>,
    expectedAnswers: readonly ExamAnswerRecord[],
    resultAnswers: readonly ExamAnswerRecord[],
  ) {
    const result = await this.database.rpc('exam_complete_manual_grading', {
      p_attempt_id: id,
      p_points: patch.points,
      p_max_points: patch.maxPoints,
      p_percent: patch.percent,
      p_result_available_at: patch.resultAvailableAt?.toISOString() ?? null,
      p_expected_answers: answerGradingSnapshot(expectedAnswers),
      p_answers: answerRpcRows(resultAnswers),
    });
    const data = record(assertDatabase(result, 'complete exam grading'));
    if (!data
      || typeof data.transitioned !== 'boolean'
      || typeof data.answersChanged !== 'boolean'
      || !data.attempt) {
      throw new Error('Invalid exam grading completion result');
    }
    return {
      attempt: toAttempt(data.attempt),
      answersChanged: data.answersChanged,
      transitioned: data.transitioned,
    };
  }

  async releaseAttempt(id: string, releasedAt: Date) {
    const result = await this.database.rpc('exam_release_attempt', {
      p_attempt_id: id,
      p_released_at: releasedAt.toISOString(),
    });
    const data = record(assertDatabase(result, 'release exam attempt'));
    if (!data || typeof data.transitioned !== 'boolean' || !data.attempt) {
      throw new Error('Invalid exam release result');
    }
    return {
      attempt: toAttempt(data.attempt),
      transitioned: data.transitioned,
    };
  }

  private async attemptOwners(attemptIds: readonly string[]) {
    const owners = new Map<string, string>();
    await Promise.all([...new Set(attemptIds)].map(async (attemptId) => {
      const attempt = await this.getAttempt(attemptId);
      if (!attempt) throw new Error('Unable to find exam attempt owner');
      owners.set(attemptId, attempt.userId);
    }));
    return owners;
  }

  async upsertAnswers(answers: readonly ExamAnswerRecord[]) {
    if (!answers.length) return;
    const owners = await this.attemptOwners(answers.map(({ attemptId }) => attemptId));
    const result = await this.database.from('exam_answers').upsert(answers.map((answer) => ({
      attempt_id: answer.attemptId,
      user_id: owners.get(answer.attemptId),
      question_id: answer.questionId,
      answer: answer.answer,
      result: answer.result,
      manual_points: answer.manualPoints,
      manual_feedback: answer.manualFeedback,
      graded_by: answer.gradedBy,
      updated_at: answer.updatedAt.toISOString(),
    })), { onConflict: 'attempt_id,question_id' });
    assertDatabase(result, 'save exam answers');
  }

  async listAnswers(attemptId: string) {
    const result = await this.database.from('exam_answers')
      .select('attempt_id,question_id,answer,result,manual_points,manual_feedback,graded_by,updated_at')
      .eq('attempt_id', attemptId)
      .order('question_id', { ascending: true });
    return rows(assertDatabase(result, 'list exam answers')).map(toAnswer);
  }

  async upsertGrade(grade: ExamGradeRecord) {
    const result = await this.database.from('exam_grades').upsert({
      user_id: grade.userId,
      course_version_id: grade.courseVersionId,
      item_id: grade.itemId,
      percent: grade.percent,
      passed: grade.passed,
      policy: grade.policy,
      computed_at: grade.computedAt.toISOString(),
    }, { onConflict: 'user_id,course_version_id,item_id' }).select('*').single();
    return toGrade(assertDatabase(result, 'save exam grade'));
  }

  async insertEvents(events: readonly ExamEventRecord[], limit: number) {
    if (!events.length) return 0;
    const grouped = new Map<string, ExamEventRecord[]>();
    for (const event of events) {
      const attemptEvents = grouped.get(event.attemptId) ?? [];
      attemptEvents.push(event);
      grouped.set(event.attemptId, attemptEvents);
    }
    const accepted = await Promise.all([...grouped].map(async ([attemptId, attemptEvents]) => {
      const result = await this.database.rpc('exam_append_attempt_events', {
        p_attempt_id: attemptId,
        p_events: attemptEvents.map((event) => ({
          id: event.id,
          type: event.type,
          at: event.at.toISOString(),
          meta: event.meta,
        })),
        p_limit: limit,
      });
      const data = assertDatabase(result, 'save exam events');
      if (typeof data !== 'number') throw new Error('Invalid exam event admission result');
      return data;
    }));
    return accepted.reduce((sum, count) => sum + count, 0);
  }

  async countEvents(attemptId: string) {
    const result = await this.database.from('exam_attempt_events')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', attemptId);
    assertDatabase(result, 'count exam events');
    return result.count ?? 0;
  }

  async listExpiredInProgress(now: Date) {
    const deadlineBefore = new Date(now.getTime() - 30_000).toISOString();
    const result = await this.database.from('exam_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('status', 'in_progress')
      .not('deadline_at', 'is', null)
      .lt('deadline_at', deadlineBefore)
      .order('deadline_at', { ascending: true });
    return rows(assertDatabase(result, 'list expired exam attempts')).map((row) => toAttempt(row));
  }
}

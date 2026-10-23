import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { SupabaseExamRepo, type ExamDatabase } from '@/features/exams/supabase-repo';
import type { ExamAttemptRecord } from '@/features/exams/types';

type Result = { data: unknown; error: unknown | null; count?: number | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly result: Result) {}
  select(columns: string, options?: unknown) { this.calls.push(['select', columns, options]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  in(column: string, value: unknown[]) { this.calls.push(['in', column, value]); return this; }
  is(column: string, value: unknown) { this.calls.push(['is', column, value]); return this; }
  lt(column: string, value: unknown) { this.calls.push(['lt', column, value]); return this; }
  not(column: string, operator: string, value: unknown) { this.calls.push(['not', column, operator, value]); return this; }
  or(filters: string, options?: unknown) { this.calls.push(['or', filters, options]); return this; }
  order(column: string, options?: unknown) { this.calls.push(['order', column, options]); return this; }
  insert(value: unknown) { this.calls.push(['insert', value]); return this; }
  update(value: unknown) { this.calls.push(['update', value]); return this; }
  upsert(value: unknown, options?: unknown) { this.calls.push(['upsert', value, options]); return this; }
  single() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class DatabaseStub implements ExamDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];
  readonly rpcCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  constructor(private readonly results: Record<string, Result[]>) {}
  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? { data: null, error: null });
    this.queries.push({ table, query });
    return query;
  }
  rpc(name: string, args?: Record<string, unknown>) {
    this.rpcCalls.push([name, args]);
    return Promise.resolve(this.results[`rpc:${name}`]?.shift() ?? { data: null, error: null });
  }
}

const attemptRow = (attemptNo: number) => ({
  id: `00000000-0000-4000-8000-00000000000${attemptNo}`,
  user_id: '00000000-0000-4000-8000-000000000010',
  course_version_id: '00000000-0000-4000-8000-000000000020',
  item_id: 'exam-one',
  attempt_no: attemptNo,
  status: 'graded',
  late: false,
  question_set: { sections: [], learner: { id: 'exam-one', kind: 'exam', title: 'Exam' }, locale: 'en', defaultLocale: 'vi' },
  grading_snapshot: { questions: {}, quizzes: {}, rubrics: {}, activities: [], exam: { scoringPolicy: 'latest', passPercent: 70 } },
  started_at: '2026-09-02T00:00:00.000Z',
  deadline_at: null,
  submitted_at: '2026-09-02T00:10:00.000Z',
  points: 8,
  max_points: 10,
  percent: 80,
  released_at: null,
  branch_id: '00000000-0000-4000-8000-000000000030',
  branch_scope_known: true,
  profile: { display_name: 'Learner One', handle: 'learner-one' },
});

describe('SupabaseExamRepo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders listAttempts by attempt_no ascending and preserves the ordering guarantee', async () => {
    const database = new DatabaseStub({ exam_attempts: [{ data: [attemptRow(1), attemptRow(2)], error: null }] });
    mocks.supabaseService.mockReturnValue(database);
    const repo = new SupabaseExamRepo();

    const attempts = await repo.listAttempts(
      '00000000-0000-4000-8000-000000000010',
      'exam-one',
      '00000000-0000-4000-8000-000000000020',
    );

    expect(attempts.map(({ attemptNo }) => attemptNo)).toEqual([1, 2]);
    expect(database.queries[0].query.calls).toContainEqual(['order', 'attempt_no', { ascending: true }]);
  });

  it('filters studio attempts by their historical branch and groups event counts in one query', async () => {
    const database = new DatabaseStub({ exam_attempts: [{
      data: [{ ...attemptRow(1), integrity_events: [{ count: 7 }] }],
      error: null,
    }] });
    const repo = new SupabaseExamRepo(database);

    const attempts = await repo.listStudioAttempts(
      'exam-one',
      attemptRow(1).course_version_id,
      attemptRow(1).branch_id,
      false,
    );

    expect(attempts).toEqual([{
      attempt: expect.objectContaining({ id: attemptRow(1).id, branchId: attemptRow(1).branch_id }),
      eventCount: 7,
      learnerName: 'Learner One',
    }]);
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'item_id', 'exam-one'],
      ['eq', 'course_version_id', attemptRow(1).course_version_id],
      ['eq', 'branch_id', attemptRow(1).branch_id],
      ['eq', 'branch_scope_known', true],
      ['order', 'attempt_no', { ascending: true }],
    ]));
    expect(database.queries[0].query.calls.find(([method]) => method === 'select')?.[1])
      .toContain('integrity_events:exam_attempt_events(count)');
  });

  it('includes only the requested branch and unassigned learners for a global studio actor', async () => {
    const branchId = attemptRow(1).branch_id;
    const unassigned = { ...attemptRow(2), branch_id: null, branch_scope_known: false, integrity_events: [{ count: 0 }] };
    const database = new DatabaseStub({ exam_attempts: [{
      data: [{ ...attemptRow(1), integrity_events: [{ count: 1 }] }, unassigned],
      error: null,
    }] });
    const repo = new SupabaseExamRepo(database);

    const attempts = await repo.listStudioAttempts(
      'exam-one',
      attemptRow(1).course_version_id,
      branchId,
      true,
    );

    expect(attempts.map(({ attempt }) => attempt.branchId)).toEqual([branchId, null]);
    expect(database.queries[0].query.calls).toContainEqual([
      'or',
      `branch_id.eq.${branchId},branch_id.is.null`,
      undefined,
    ]);
    expect(database.queries[0].query.calls).not.toContainEqual(['eq', 'branch_id', branchId]);
  });

  it('counts unassigned studio attempts with item and course-version predicates', async () => {
    const database = new DatabaseStub({ exam_attempts: [{ data: null, error: null, count: 3 }] });
    const repo = new SupabaseExamRepo(database);

    await expect(repo.countUnassignedStudioAttempts(
      'exam-one',
      attemptRow(1).course_version_id,
    )).resolves.toBe(3);

    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'item_id', 'exam-one'],
      ['eq', 'course_version_id', attemptRow(1).course_version_id],
      ['eq', 'branch_scope_known', false],
    ]));
  });

  it('uses the attempt owner for answer upserts required by the composite foreign key', async () => {
    const database = new DatabaseStub({
      exam_attempts: [{ data: attemptRow(1), error: null }],
      exam_answers: [{ data: [], error: null }],
    });
    mocks.supabaseService.mockReturnValue(database);
    const repo = new SupabaseExamRepo();

    await repo.upsertAnswers([{
      attemptId: attemptRow(1).id,
      questionId: 'section/question',
      answer: 'a',
      result: null,
      manualPoints: null,
      manualFeedback: null,
      gradedBy: null,
      updatedAt: new Date('2026-09-02T00:05:00.000Z'),
    }]);

    expect(database.queries[1].query.calls).toContainEqual(['upsert', [expect.objectContaining({
      attempt_id: attemptRow(1).id,
      user_id: attemptRow(1).user_id,
      question_id: 'section/question',
    })], { onConflict: 'attempt_id,question_id' }]);
  });

  it('saves learner answers through the active-attempt transaction function', async () => {
    const database = new DatabaseStub({ 'rpc:exam_save_active_answers': [{ data: true, error: null }] });
    const repo = new SupabaseExamRepo(database);
    const answer = {
      attemptId: attemptRow(1).id,
      questionId: 'section/question',
      answer: 'a',
      result: null,
      manualPoints: null,
      manualFeedback: null,
      gradedBy: null,
      updatedAt: new Date('2026-09-02T00:05:00.000Z'),
    };

    await expect(repo.saveActiveAnswers(attemptRow(1).id, attemptRow(1).user_id, [answer])).resolves.toBe(true);
    expect(database.rpcCalls).toEqual([['exam_save_active_answers', expect.objectContaining({
      p_attempt_id: attemptRow(1).id,
      p_user_id: attemptRow(1).user_id,
      p_answers: [expect.objectContaining({ questionId: 'section/question', answer: 'a' })],
    })]]);
  });

  it('finalizes attempt results through one transactional compare-and-set call', async () => {
    const row = attemptRow(1);
    const database = new DatabaseStub({
      'rpc:exam_finalize_attempt': [{ data: { transitioned: true, answersChanged: false, attempt: row }, error: null }],
    });
    const repo = new SupabaseExamRepo(database);
    await expect(repo.finalizeAttempt(row.id, {
      status: 'graded', late: false, submittedAt: new Date(row.submitted_at),
      points: 8, maxPoints: 10, percent: 80,
    }, [], [])).resolves.toMatchObject({
      transitioned: true,
      answersChanged: false,
      attempt: { id: row.id, status: 'graded', percent: 80 },
    });
    expect(database.rpcCalls).toEqual([['exam_finalize_attempt', expect.objectContaining({
      p_attempt_id: row.id,
      p_status: 'graded',
      p_expected_answers: {},
      p_answers: [],
    })]]);
  });

  it('releases an attempt through one timestamp-preserving compare-and-set call', async () => {
    const row = { ...attemptRow(1), released_at: '2026-09-02T01:00:00.000Z' };
    const database = new DatabaseStub({
      'rpc:exam_release_attempt': [{ data: { transitioned: true, attempt: row }, error: null }],
    });
    const repo = new SupabaseExamRepo(database);
    const at = new Date('2026-09-02T01:00:00.000Z');

    await expect(repo.releaseAttempt(row.id, at)).resolves.toMatchObject({
      transitioned: true,
      attempt: { id: row.id, releasedAt: at },
    });
    expect(database.rpcCalls).toEqual([['exam_release_attempt', {
      p_attempt_id: row.id,
      p_released_at: at.toISOString(),
    }]]);
  });

  it('passes more than 250 immutable result rows to finalization', async () => {
    const row = attemptRow(1);
    const database = new DatabaseStub({
      'rpc:exam_finalize_attempt': [{ data: { transitioned: true, answersChanged: false, attempt: row }, error: null }],
    });
    const repo = new SupabaseExamRepo(database);
    const results = Array.from({ length: 251 }, (_, index) => ({
      attemptId: row.id,
      questionId: `section/q-${index}`,
      answer: index,
      result: null,
      manualPoints: null,
      manualFeedback: null,
      gradedBy: null,
      updatedAt: new Date(row.submitted_at),
    }));

    await repo.finalizeAttempt(row.id, {
      status: 'graded', late: false, submittedAt: new Date(row.submitted_at),
      points: 8, maxPoints: 10, percent: 80,
    }, [], results);

    expect(database.rpcCalls[0]?.[1]?.p_answers).toHaveLength(251);
  });

  it('starts attempts through the atomic admission procedure', async () => {
    const row = attemptRow(1);
    const database = new DatabaseStub({ 'rpc:exam_start_attempt': [{ data: row, error: null }] });
    mocks.supabaseService.mockReturnValue(database);
    const repo = new SupabaseExamRepo();

    await expect(repo.insertAttempt({
      id: row.id,
      userId: row.user_id,
      courseVersionId: row.course_version_id,
      itemId: row.item_id,
      branchId: row.branch_id,
      attemptNo: 1,
      status: 'in_progress',
      late: false,
      questionSet: row.question_set as ExamAttemptRecord['questionSet'],
      gradingSnapshot: row.grading_snapshot as never,
      startedAt: new Date(row.started_at),
      deadlineAt: null,
      submittedAt: null,
      points: null,
      maxPoints: null,
      percent: null,
      releasedAt: null,
      resultAvailableAt: null,
    }, 2)).resolves.toMatchObject({ attemptNo: 1 });

    expect(database.rpcCalls).toEqual([['exam_start_attempt', expect.objectContaining({
      p_id: row.id,
      p_attempts_allowed: 2,
    })]]);
  });

  it('admits event batches through the atomic capped append procedure', async () => {
    const database = new DatabaseStub({ 'rpc:exam_append_attempt_events': [{ data: 1, error: null }] });
    mocks.supabaseService.mockReturnValue(database);
    const repo = new SupabaseExamRepo();

    await expect(repo.insertEvents([{
      id: '00000000-0000-4000-8000-000000000099',
      attemptId: attemptRow(1).id,
      type: 'paste',
      at: new Date('2026-09-02T00:01:00.000Z'),
      meta: {},
    }], 500)).resolves.toBe(1);

    expect(database.rpcCalls).toEqual([['exam_append_attempt_events', expect.objectContaining({
      p_attempt_id: attemptRow(1).id,
      p_limit: 500,
    })]]);
  });
});

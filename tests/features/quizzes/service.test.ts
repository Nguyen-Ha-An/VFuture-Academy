import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only',()=>({}));

import { compileCourse, type CompiledItem } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import { createQuizService, type QuizDatabase } from '@/features/quizzes/service';
import type { GradingQuestion } from '@/content-engine/compile/project';

type QueryError = { code?: string; message?: string };
type QueryResult = { data: unknown; error: QueryError | null; count?: number | null };

class Query implements PromiseLike<QueryResult> {
  readonly calls: Array<[string, ...unknown[]]> = [];

  constructor(private readonly result: QueryResult) {}

  select(columns: string, options?: unknown) {
    this.calls.push(['select', columns, options]);
    return this;
  }

  eq(column: string, value: unknown) {
    this.calls.push(['eq', column, value]);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.calls.push(['in', column, values]);
    return this;
  }

  insert(value: Record<string, unknown>) {
    this.calls.push(['insert', value]);
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.result);
  }

  single() {
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class DatabaseStub implements QuizDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];

  constructor(private readonly results: Record<string, QueryResult[]>) {}

  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? { data: null, error: null });
    this.queries.push({ table, query });
    return query;
  }
}

const actor = { id: 'learner-1', locale: 'en' as const };
let lesson: CompiledItem;

beforeAll(async () => {
  const compiled = await compileCourse(FIXTURES['ai-foundations'], fixtureResolver, { publish: true });
  if (!compiled.ok || !compiled.compiled) throw new Error('fixture compilation failed');
  lesson = compiled.compiled.items['what-is-ai'];
});

function databaseFor(grading: CompiledItem['grading'], attempts: number, attemptId = 'attempt-1') {
  return new DatabaseStub({
    enrollments: [{ data: { course_version_id: 'version-1' }, error: null }],
    course_version_items: [{ data: { grading }, error: null }],
    quiz_attempts: [
      { data: null, error: null, count: attempts },
      { data: { id: attemptId }, error: null },
    ],
  });
}

describe('quiz service', () => {
  it.each(['check','submit'] as const)('blocks live quiz %s at an explicitly suspended trusted enrollment branch',async(action)=>{
    const database=new DatabaseStub({
      enrollments:[{data:{course_version_id:'version-1',branch_id:'school-a',branch_scope_known:true},error:null}],
      branch_memberships:[{data:{status:'suspended'},error:null}],
    });
    const service=createQuizService({database});
    const result=action==='check'
      ? service.check(actor,'ai-foundations','what-is-ai','check-1','check-1/q1','a')
      : service.submit(actor,'ai-foundations','what-is-ai','check-1',{});
    await expect(result).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(database.queries.map(({table})=>table)).toEqual(['enrollments','branch_memberships']);
  });
  it('returns ENROLLMENT_NOT_FOUND when the learner has no active enrollment', async () => {
    const database = new DatabaseStub({
      enrollments: [{ data: null, error: null }],
    });
    const service = createQuizService({ database });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {}))
      .rejects.toMatchObject({ status: 404, code: 'ENROLLMENT_NOT_FOUND' });
  });

  it('returns ITEM_NOT_FOUND when the pinned course item has no grading data', async () => {
    const database = new DatabaseStub({
      enrollments: [{ data: { course_version_id: 'version-1' }, error: null }],
      course_version_items: [{ data: null, error: null }],
    });
    const service = createQuizService({ database });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {}))
      .rejects.toMatchObject({ status: 404, code: 'ITEM_NOT_FOUND' });
  });

  it('returns QUIZ_NOT_FOUND when the requested quiz is absent from the pinned item', async () => {
    const service = createQuizService({ database: databaseFor(lesson.grading, 0) });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'other-quiz', {}))
      .rejects.toMatchObject({ status: 404, code: 'QUIZ_NOT_FOUND' });
  });

  it('returns a typed conflict when all graded quiz attempts are exhausted', async () => {
    const database = databaseFor(lesson.grading, 3);
    const service = createQuizService({ database });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {}))
      .rejects.toMatchObject({ status: 409, code: 'ATTEMPTS_EXHAUSTED' });
    expect(database.queries.map(({ table }) => table)).toEqual([
      'enrollments',
      'course_version_items',
      'quiz_attempts',
    ]);
  });

  it('maps a duplicate attempt insert to ATTEMPT_CONFLICT', async () => {
    const database = new DatabaseStub({
      enrollments: [{ data: { course_version_id: 'version-1' }, error: null }],
      course_version_items: [{ data: { grading: lesson.grading }, error: null }],
      quiz_attempts: [
        { data: null, error: null, count: 0 },
        { data: null, error: { code: '23505' } },
      ],
    });
    const service = createQuizService({ database });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {}))
      .rejects.toMatchObject({ status: 409, code: 'ATTEMPT_CONFLICT' });
  });

  it('returns the answer and localized explanation for a per-question practice check', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      showExplanations: true,
    };
    const database = databaseFor(grading, 0);
    const service = createQuizService({ database });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q1',
      'a',
    )).resolves.toMatchObject({
      questionId: 'check-1/q1',
      status: 'correct',
      points: 1,
      maxPoints: 1,
      revealed: {
        correctAnswers: { 'check-1/q1': 'a' },
        explanations: {
          'check-1/q1': {
            blocks: [{ type: 'paragraph', content: [{ text: 'Machine learning learns from data rather than fixed rules only.' }] }],
          },
        },
      },
    });
  });

  it('rejects question checks for graded quizzes even with per-question feedback', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'graded',
      feedback: 'per_question',
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q1',
      'a',
    )).rejects.toMatchObject({ status: 409, code: 'CHECK_NOT_ALLOWED' });
  });

  it('rejects question checks unless a practice quiz enables per-question feedback', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'after_submit',
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q1',
      'a',
    )).rejects.toMatchObject({ status: 409, code: 'CHECK_NOT_ALLOWED' });
  });

  it('rejects checking a question-group parent so one response cannot reveal every child answer', async () => {
    const grading = structuredClone(lesson.grading);
    const child = {
      ...grading.questions['check-1/q1'],
      id: 'check-1/group/c1',
      parentId: 'check-1/group',
    };
    grading.questions['check-1/group'] = {
      ...grading.questions['check-1/q1'],
      id: 'check-1/group',
      type: 'question_group',
      points: child.points,
      children: [child],
    };
    grading.questions[child.id] = child;
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      questionIds: ['check-1/group'],
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/group',
      { [child.id]: 'a' },
    )).rejects.toMatchObject({ status: 409, code: 'CHECK_NOT_ALLOWED' });
  });

  it('checks one leaf inside a question group without revealing sibling answers', async () => {
    const grading = structuredClone(lesson.grading);
    const child = {
      ...grading.questions['check-1/q1'],
      id: 'check-1/group/c1',
      parentId: 'check-1/group',
    };
    const sibling = {
      ...grading.questions['check-1/q3'],
      id: 'check-1/group/c2',
      parentId: 'check-1/group',
    };
    grading.questions['check-1/group'] = {
      ...grading.questions['check-1/q1'],
      id: 'check-1/group',
      type: 'question_group',
      points: child.points + sibling.points,
      children: [child, sibling],
    };
    grading.questions[child.id] = child;
    grading.questions[sibling.id] = sibling;
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      questionIds: ['check-1/group'],
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    const result = await service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      child.id,
      'a',
    );

    expect(result).toMatchObject({
      questionId: child.id,
      status: 'correct',
      revealed: { correctAnswers: { [child.id]: 'a' } },
    });
    expect(result.revealed.correctAnswers).not.toHaveProperty(sibling.id);
  });

  it('rejects a question id that exists in grading data but belongs outside the quiz', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      questionIds: ['check-1/q1'],
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q2',
      ['a'],
    )).rejects.toMatchObject({ status: 404, code: 'QUESTION_NOT_FOUND' });
  });

  it('rejects a cross-quiz question without recursing forever through a grading cycle', async () => {
    const grading = structuredClone(lesson.grading);
    const root = grading.questions['check-1/q1'];
    root.children = [{ ...root }];
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      questionIds: [root.id],
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'check-1/q2',
      ['a'],
    )).rejects.toMatchObject({ status: 404, code: 'QUESTION_NOT_FOUND' });
  });

  it('rejects question membership paths deeper than eight edges', async () => {
    const grading = structuredClone(lesson.grading);
    const template = grading.questions['check-1/q1'];
    for (let depth = 0; depth < 9; depth += 1) {
      const id = `chain-${depth}`;
      const childId = `chain-${depth + 1}`;
      grading.questions[id] = {
        ...template,
        id,
        children: [{ ...template, id: childId }],
      };
    }
    grading.questions['chain-9'] = { ...template, id: 'chain-9' };
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      mode: 'practice',
      feedback: 'per_question',
      questionIds: ['chain-0'],
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    await expect(service.check(
      actor,
      'ai-foundations',
      'what-is-ai',
      'check-1',
      'chain-9',
      'a',
    )).rejects.toMatchObject({ status: 404, code: 'QUESTION_NOT_FOUND' });
  });

  it('grades the quiz, persists the next attempt, and recomputes progress', async () => {
    const database = databaseFor(lesson.grading, 1, 'attempt-2');
    const hooks = { recompute: vi.fn(async () => undefined) };
    const service = createQuizService({ database, hooks });
    const answers = {
      'check-1/q1': 'a',
      'check-1/q3': false,
      'check-1/q4': { b1: 'prompt' },
    };

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', answers);

    expect(result).toMatchObject({
      attemptId: 'attempt-2',
      points: 3,
      maxPoints: 5,
      percent: 60,
      passed: true,
      attemptsRemaining: 1,
    });
    expect(result.results).toHaveLength(4);
    const insert = database.queries.findLast(({ table }) => table === 'quiz_attempts')?.query.calls
      .find(([name]) => name === 'insert')?.[1];
    expect(insert).toMatchObject({
      user_id: 'learner-1',
      course_version_id: 'version-1',
      item_id: 'what-is-ai',
      quiz_id: 'check-1',
      attempt_no: 2,
      answers,
      points: 3,
      max_points: 5,
      percent: 60,
      passed: true,
    });
    expect(hooks.recompute).toHaveBeenCalledWith(actor, 'ai-foundations');
  });

  it('returns the graded quiz DTO when post-commit progress recompute fails', async () => {
    const database = databaseFor(lesson.grading, 0, 'attempt-durable');
    const failure = new Error('progress unavailable');
    const hooks = { recompute: vi.fn(async () => { throw failure; }) };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createQuizService({ database, hooks });

    try {
      await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
        'check-1/q1': 'a',
      })).resolves.toMatchObject({
        attemptId: 'attempt-durable',
        points: 1,
        maxPoints: 5,
        percent: 20,
        passed: false,
        attemptsRemaining: 2,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'Quiz post-commit side effect failed',
        expect.objectContaining({
          effect: 'progress.recompute',
          attemptId: 'attempt-durable',
          courseVersionId: 'version-1',
          correlationId: expect.any(String),
          error: failure,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('drops answer keys outside the selected quiz before grading and persistence', async () => {
    const database = databaseFor(lesson.grading, 0);
    const service = createQuizService({ database });

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a',
      'other-quiz/q1': 'stolen',
    });

    expect(result.results.find(({ questionId }) => questionId === 'check-1/q1'))
      .toMatchObject({ status: 'correct' });
    const insert = database.queries.findLast(({ table }) => table === 'quiz_attempts')?.query.calls
      .find(([name]) => name === 'insert')?.[1] as { answers?: Record<string, unknown> } | undefined;
    expect(insert?.answers).toEqual({ 'check-1/q1': 'a' });
    expect(insert?.answers).not.toHaveProperty('other-quiz/q1');
  });

  it('ignores inherited answer properties when grading and persistence', async () => {
    const database = databaseFor(lesson.grading, 0);
    const service = createQuizService({ database });
    const answers = Object.create({ 'check-1/q1': 'a' }) as Record<string, unknown>;

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', answers);

    expect(result.results.find(({ questionId }) => questionId === 'check-1/q1'))
      .toMatchObject({ status: 'incomplete' });
    const insert = database.queries.findLast(({ table }) => table === 'quiz_attempts')?.query.calls
      .find(([name]) => name === 'insert')?.[1] as { answers?: Record<string, unknown> } | undefined;
    expect(Object.keys(insert?.answers ?? {})).toEqual([]);
    expect(Object.getPrototypeOf(insert?.answers)).toBeNull();
  });

  it('reveals correct answers but hides explanations when showExplanations is false', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      feedback: 'after_submit',
      showExplanations: false,
    };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a',
    });

    expect(result.revealed.correctAnswers).toMatchObject({ 'check-1/q1': 'a' });
    expect(result.revealed).not.toHaveProperty('explanations');
    expect(result.revealed).not.toHaveProperty('optionFeedback');
  });

  it.each(['none', 'after_submit'] as const)('projects nested result parts under %s feedback in responses and storage', async (feedback) => {
    const grading = structuredClone(lesson.grading);
    const child: GradingQuestion = { ...grading.questions['check-1/q1'], id: 'check-1/group/child', type: 'multiple_choice', correctAnswer: ['a', 'secret-key'] };
    grading.questions['check-1/group'] = { ...child, id: 'check-1/group', type: 'question_group', children: [child] };
    grading.quizzes['check-1'] = { ...grading.quizzes['check-1'], questionIds: ['check-1/group'], feedback };
    const database = databaseFor(grading, 0);
    const result = await createQuizService({ database }).submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/group': { child: ['a'] } });
    const inserted = database.queries.findLast(({ table }) => table === 'quiz_attempts')?.query.calls.find(([name]) => name === 'insert')?.[1] as { results: unknown };
    for (const value of [result.results, inserted.results]) {
      if (feedback === 'none') expect(JSON.stringify(value)).not.toContain('parts');
      else expect(JSON.stringify(value)).toContain('secret-key');
    }
  });

  it('reveals nothing for feedback none and never serializes a correctAnswer key', async () => {
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = {
      ...grading.quizzes['check-1'],
      attemptsAllowed: 0,
      feedback: 'none',
      showExplanations: true,
    };
    const service = createQuizService({ database: databaseFor(grading, 8) });

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a',
    });

    expect(result.attemptsRemaining).toBeNull();
    expect(result.revealed).toEqual({});
    expect(JSON.stringify(result)).not.toContain('correctAnswer');
    expect(JSON.stringify(result)).not.toContain('explanation');
  });

  it('omits passed when no threshold is configured while persisting the non-passing default', async () => {
    const grading = structuredClone(lesson.grading);
    delete grading.quizzes['check-1'].passPercent;
    const database = databaseFor(grading, 0);
    const service = createQuizService({ database });

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {});

    expect(result).not.toHaveProperty('passed');
    const insert = database.queries.findLast(({ table }) => table === 'quiz_attempts')?.query.calls
      .find(([name]) => name === 'insert')?.[1];
    expect(insert).toMatchObject({ passed: false });
  });

  it('keeps a submitted quiz successful when progress and XP hooks fail', async () => {
    const database = databaseFor(lesson.grading, 0, 'attempt-hooks');
    const recompute = vi.fn().mockRejectedValue(new Error('progress unavailable'));
    const awardXp = vi.fn().mockRejectedValue(new Error('xp unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createQuizService({ database, hooks: { recompute, awardXp } });

    try {
      await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
        'check-1/q1': 'a',
      })).resolves.toMatchObject({ attemptId: 'attempt-hooks' });
      expect(recompute).toHaveBeenCalledOnce();
      expect(awardXp).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'learner-1',
        kind: 'quiz_submitted',
        refId: 'attempt-hooks',
        points: 7,
      }));
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});

describe('quiz result availability', () => {
  it('publishes the score of an automatic quiz regardless of its feedback setting', async () => {
    // A quiz of auto-graded questions completes grading at submit, so its score is
    // the learner's immediately. `feedback: 'none'` withholds the answer key and
    // explanations only — the same separation the exam side now enforces.
    const grading = structuredClone(lesson.grading);
    grading.quizzes['check-1'] = { ...grading.quizzes['check-1'], feedback: 'none', showExplanations: false };
    const service = createQuizService({ database: databaseFor(grading, 0) });

    const result = await service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a' });

    expect(result.points).toBe(1);
    expect(result.maxPoints).toBeGreaterThan(0);
    expect(result.percent).toBeGreaterThan(0);
    expect(result.results).toHaveLength(grading.quizzes['check-1'].questionIds.length);
    // The score is published; only the key stays withheld.
    expect(result.revealed).toEqual({});
  });

  it.each(['essay', 'legacy_regex', 'group'] as const)('refuses an incomplete %s quiz grade without consuming an attempt or awarding progress', async (kind) => {
    const grading = structuredClone(lesson.grading);
    const manual: GradingQuestion = kind === 'legacy_regex'
      ? { id: 'check-1/manual', type: 'short_answer', points: 3, settings: {}, interactionType: 'text', selfAssessment: false, matchMode: 'regex', correctAnswer: ['(?=answer)answer'] }
      : { id: 'check-1/manual', type: 'essay', points: 3, settings: {}, interactionType: 'textarea', selfAssessment: false };
    const question: GradingQuestion = kind === 'group'
      ? { id: 'check-1/group', type: 'question_group', points: 3, settings: {}, interactionType: 'group', selfAssessment: false, children: [manual] }
      : manual;
    grading.questions[question.id] = question;
    grading.quizzes['check-1'].questionIds.push(question.id);
    const database = databaseFor(grading, 0);
    const hooks = { recompute: vi.fn(), awardXp: vi.fn() };
    const service = createQuizService({ database, hooks });
    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a', [question.id]: kind === 'group' ? { [manual.id]: 'answer' } : 'answer',
    })).rejects.toMatchObject({ status: 422, code: 'QUIZ_REQUIRES_MANUAL_GRADING' });
    expect(database.queries.flatMap(({ query }) => query.calls).some(([operation]) => operation === 'insert')).toBe(false);
    expect(hooks.recompute).not.toHaveBeenCalled();
    expect(hooks.awardXp).not.toHaveBeenCalled();
  });

  const regexQuestion = (overrides: Partial<GradingQuestion> = {}): GradingQuestion => ({
    id: 'check-1/regex', type: 'short_answer', points: 3, settings: {}, interactionType: 'text',
    selfAssessment: false, matchMode: 'regex', correctAnswer: ['answer'], ...overrides,
  });
  const withQuestion = (question: GradingQuestion) => {
    const grading = structuredClone(lesson.grading);
    grading.questions[question.id] = question;
    grading.quizzes['check-1'].questionIds.push(question.id);
    return grading;
  };
  const longAnswer = 'a'.repeat(1200);
  type RejectedIssue = { path: unknown[]; message: string; code?: string; pointer?: string; localizedMessage?: { vi: string; en: string } };
  const rejection = <T,>(promise: Promise<T>) => promise.then(
    () => { throw new Error('expected the request to be rejected'); },
    (error: unknown) => error as { status: number; code: string; message: string; issues?: RejectedIssue[] },
  );

  it('rejects an over-long regex answer with an answer-length error, not a manual-grading refusal', async () => {
    // The quiz is fully auto-gradable; only this one answer exceeds the matcher bound.
    const grading = withQuestion(regexQuestion());
    const database = databaseFor(grading, 0);
    const hooks = { recompute: vi.fn(), awardXp: vi.fn() };
    const service = createQuizService({ database, hooks });

    const error = await rejection(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a', 'check-1/regex': `  ${longAnswer}  `,
    }));

    expect(error).toMatchObject({ status: 422, code: 'QUIZ_ANSWER_TOO_LONG' });
    // Precise: the offending question, its length and the bound it exceeded.
    expect(error.issues).toEqual([expect.objectContaining({
      path: ['answers', 'check-1/regex'],
      message: 'The answer is 1200 characters; the limit is 1000.',
      code: 'QUIZ_ANSWER_TOO_LONG',
      pointer: '/answers/check-1/regex',
    })]);
    expect(error.issues?.[0].localizedMessage?.vi).toContain('1200');
    // The learner keeps the attempt, the answers and any XP.
    expect(database.queries.flatMap(({ query }) => query.calls).some(([operation]) => operation === 'insert')).toBe(false);
    expect(hooks.recompute).not.toHaveBeenCalled();
    expect(hooks.awardXp).not.toHaveBeenCalled();
    // No advice to change content that is not at fault.
    expect(error.message).not.toContain('instructor');
    expect(error.message).toContain('No attempt was consumed');
  });

  it('reports the over-long answer of a question-group child', async () => {
    const child = regexQuestion({ id: 'check-1/group/regex', parentId: 'check-1/group' });
    const group: GradingQuestion = { id: 'check-1/group', type: 'question_group', points: 3, settings: {}, interactionType: 'group', selfAssessment: false, children: [child] };
    const service = createQuizService({ database: databaseFor(withQuestion(group), 0) });

    await expect(service.submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', {
      'check-1/q1': 'a', 'check-1/group': { regex: longAnswer },
    })).rejects.toMatchObject({
      status: 422,
      code: 'QUIZ_ANSWER_TOO_LONG',
      issues: [expect.objectContaining({ path: ['answers', 'check-1/group/regex'] })],
    });
  });

  it('still refuses an unsupported answer key even when the answer is over-long', async () => {
    // The pattern, not the answer, is what a human has to judge here.
    const grading = withQuestion(regexQuestion({ correctAnswer: ['(?=answer)answer'] }));
    await expect(createQuizService({ database: databaseFor(grading, 0) })
      .submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a', 'check-1/regex': longAnswer }))
      .rejects.toMatchObject({ status: 422, code: 'QUIZ_REQUIRES_MANUAL_GRADING' });
  });

  it('grades an answer at the matcher bound, and a long answer that is not matched by regex', async () => {
    const atLimit = await createQuizService({ database: databaseFor(withQuestion(regexQuestion({ correctAnswer: ['^a+$'] })), 0) })
      .submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a', 'check-1/regex': 'a'.repeat(1000) });
    expect(atLimit.results.find(({ questionId }) => questionId === 'check-1/regex')?.status).toBe('correct');

    const contains = await createQuizService({ database: databaseFor(withQuestion(regexQuestion({ matchMode: 'contains', correctAnswer: ['answer'] })), 0) })
      .submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a', 'check-1/regex': `${longAnswer} answer` });
    expect(contains.results.find(({ questionId }) => questionId === 'check-1/regex')?.status).toBe('correct');
  });

  it('rejects an over-long regex answer on a per-question check, in the actor locale', async () => {
    const grading = withQuestion(regexQuestion());
    grading.quizzes['check-1'] = { ...grading.quizzes['check-1'], mode: 'practice', feedback: 'per_question' };
    const service = createQuizService({ database: databaseFor(grading, 0) });
    await expect(service.check({ ...actor, locale: 'vi' }, 'ai-foundations', 'what-is-ai', 'check-1', 'check-1/regex', longAnswer))
      .rejects.toMatchObject({ status: 422, code: 'QUIZ_ANSWER_TOO_LONG', message: expect.stringContaining('1000 ký tự') });
  });

  it('keeps self-assessed reflection questions available without manual grading', async () => {
    const grading = structuredClone(lesson.grading);
    const reflection: GradingQuestion = { id: 'check-1/reflection', type: 'essay', points: 3, settings: {}, interactionType: 'textarea', selfAssessment: true };
    grading.questions[reflection.id] = reflection;
    grading.quizzes['check-1'].questionIds.push(reflection.id);
    const result = await createQuizService({ database: databaseFor(grading, 0) })
      .submit(actor, 'ai-foundations', 'what-is-ai', 'check-1', { 'check-1/q1': 'a', [reflection.id]: 'My reflection' });
    expect(result.results.find(({ questionId }) => questionId === reflection.id)?.status).toBe('self_assessed');
  });
});

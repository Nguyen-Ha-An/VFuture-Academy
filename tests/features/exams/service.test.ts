import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(async () => undefined) }));
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService, type ExamStartResult } from '@/features/exams/service';
import type {
  BankListQuery,
  ExamActor,
  ExamAttemptRecord,
  ExamRepo,
} from '@/features/exams/types';
import {
  bankSource,
  compileExamFixtures,
  instructor,
  itemContext,
  learner,
  MutableClock,
  otherLearner,
  withExamSettings,
} from './test-kit';

let aiExam: CompiledItem;
let allTypesExam: CompiledItem;

beforeAll(async () => {
  ({ ai: aiExam, all: allTypesExam } = await compileExamFixtures());
});

function harness(
  item: CompiledItem,
  at = '2026-09-02T00:00:00.000Z',
  isEnrolled: (userId: string, courseVersionId: string) => Promise<boolean> = async () => true,
) {
  const repo = new InMemoryExamRepo();
  const clock = new MutableClock(new Date(at));
  const service = createExamService({
    repo,
    clock,
    bank: bankSource,
    loadItem: async (_actor, _courseId, itemId) => itemId === item.id ? itemContext(item) : null,
    isEnrolled,
  });
  return { repo, clock, service };
}

function answersFor(attempt: ExamAttemptRecord, correct: boolean): Record<string, unknown> {
  return Object.fromEntries(attempt.questionSet.sections.flatMap((section) => section.questionIds.map((id) => [
    id,
    id === 's1/x1'
      ? correct ? ['inline', 'ref', 'pool'] : ['lesson']
      : correct ? 'a' : 'b',
  ])));
}

function withManualQuestionGroup(item: CompiledItem): CompiledItem {
  const copy = structuredClone(item);
  const auto = {
    ...structuredClone(copy.grading.questions['s1/x1']),
    id: 's1/x1/auto',
    parentId: 's1/x1',
  };
  const essay = {
    ...structuredClone(aiExam.grading.questions['s2/e2']),
    id: 's1/x1/essay',
    parentId: 's1/x1',
  };
  copy.grading.questions['s1/x1'] = {
    id: 's1/x1',
    type: 'question_group',
    points: auto.points + essay.points,
    settings: {},
    interactionType: 'list',
    selfAssessment: false,
    children: [auto, essay],
  };
  copy.grading.questions[auto.id] = auto;
  copy.grading.questions[essay.id] = essay;
  for (const render of Object.values(copy.renders)) {
    const sections = render.sections as { id: string; questions: Record<string, unknown>[] }[];
    const section = sections.find((entry) => entry.id === 's1');
    if (!section) continue;
    section.questions = section.questions.map((question) => question.id === 's1/x1'
      ? {
        id: 's1/x1',
        type: 'question_group',
        questions: [
          { id: auto.id, type: auto.type },
          { id: essay.id, type: essay.type },
        ],
      }
      : question);
  }
  return copy;
}

function attemptIdOf(started: ExamStartResult): string {
  return started.attemptId;
}

async function storedAttempt(repo: InMemoryExamRepo, started: ExamStartResult): Promise<ExamAttemptRecord> {
  const attempt = await repo.getAttempt(attemptIdOf(started));
  if (!attempt) throw new Error('expected the started attempt to be stored');
  return attempt;
}

function assertNoAnswerKeys(value: unknown): void {
  const forbidden = new Set([
    'correctAnswer', 'explanation', 'feedback', 'optionFeedback', 'rubric', 'sampleAnswer', 'sampleSolution', 'sourceRef',
  ]);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}/${index}`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, entry] of Object.entries(node)) {
      if (key === 'settings' || key === 'display') continue;
      expect(forbidden.has(key), `answer key ${key} leaked at ${path}/${key}`).toBe(false);
      walk(entry, `${path}/${key}`);
    }
  };
  walk(JSON.parse(JSON.stringify(value)), '');
}

async function startAndSubmit(item: CompiledItem, correct = true) {
  const h = harness(item);
  const started = await h.service.start(learner, 'course-1', item.id);
  const attempt = await storedAttempt(h.repo, started);
  await h.service.save(learner, attempt.id, answersFor(attempt, correct));
  const submitted = await h.service.submit(learner, attempt.id);
  return { ...h, attempt, started, submitted };
}

describe('exam lifecycle', () => {
  it('emits a non-fatal passed hook with the graded attempt', async () => {
    const item = structuredClone(allTypesExam);
    for (const question of Object.values(item.grading.questions)) question.skills = ['ai-literacy'];
    const repo = new InMemoryExamRepo();
    const onExamPassed = vi.fn(async () => { throw new Error('skills unavailable'); });
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(item),
      isEnrolled: async () => true,
      onExamPassed,
    });
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, answersFor(attempt, true));

    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ passed: true });
    expect(onExamPassed).toHaveBeenCalledWith(expect.objectContaining({
      id: attempt.id,
      userId: learner.id,
      status: 'graded',
    }));
  });

  it('tracks exam start and submit once after each persisted transition', async () => {
    const repo = new InMemoryExamRepo();
    const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
    const track = vi.fn(async () => undefined);
    const service = createExamService({
      repo,
      clock,
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      track,
    });

    const started = await service.start(learner, 'course-1', allTypesExam.id);
    await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, answersFor(attempt, true));
    await service.submit(learner, attempt.id);

    expect(track).toHaveBeenNthCalledWith(1, 'exam.started', expect.objectContaining({
      userId: learner.id,
      courseId: 'course-1',
      itemId: allTypesExam.id,
      attemptId: attempt.id,
    }));
    expect(track).toHaveBeenNthCalledWith(2, 'exam.submitted', expect.objectContaining({
      userId: learner.id,
      itemId: allTypesExam.id,
      attemptId: attempt.id,
      percent: 100,
    }));
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('does not await analytics on the exam request path and logs rejected delivery', async () => {
    const repo = new InMemoryExamRepo();
    const track = vi.fn(() => new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error('analytics down')), 20);
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      track,
    });

    const outcome = await Promise.race([
      service.start(learner, 'course-1', allTypesExam.id).then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 5)),
    ]);

    expect(outcome).toBe('completed');
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Analytics tracking failed', expect.any(Error)));
    error.mockRestore();
  });

  it('resumes the same in-progress attempt without consuming another attempt', async () => {
    const { repo, service } = harness(allTypesExam);
    const first = await service.start(learner, 'course-1', allTypesExam.id);
    const resumed = await service.start(learner, 'course-1', allTypesExam.id);

    expect(attemptIdOf(resumed)).toBe(attemptIdOf(first));
    expect(resumed.learner).toEqual(first.learner);
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
  });

  it('returns saved answers and absolute section deadlines when resuming', async () => {
    const item = structuredClone(allTypesExam);
    item.grading.exam!.sections.forEach((section, index) => {
      section.timeLimitMinutes = index + 2;
    });
    const { repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    const questionId = attempt.questionSet.sections[0].questionIds[0];
    await service.save(learner, attempt.id, { [questionId]: 'saved answer' });

    const resumed = await service.start(learner, 'course-1', item.id);

    expect(started.answers).toEqual({});
    expect(resumed.answers).toEqual({ [questionId]: 'saved answer' });
    expect(resumed.sectionDeadlines).toEqual(Object.fromEntries(
      attempt.questionSet.sections.map((section) => [
        section.id,
        section.deadlineOffsetMs === null
          ? null
          : new Date(attempt.startedAt.getTime() + section.deadlineOffsetMs),
      ]),
    ));
  });

  it('restores the active attempt snapshot without creating another attempt', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    const questionId = attempt.questionSet.sections[0].questionIds[0];
    await service.save(learner, attempt.id, { [questionId]: 'a' });
    const session = (service as unknown as {
      session(actor: ExamActor, courseId: string, itemId: string): Promise<{
        attemptsUsed: number;
        attempt: ExamStartResult | null;
      }>;
    }).session;

    await expect(session(learner, 'course-1', allTypesExam.id)).resolves.toMatchObject({
      attemptsUsed: 1,
      attempt: {
        attemptId: started.attemptId,
        status: 'in_progress',
        answers: { [questionId]: 'a' },
        deadlineAt: expect.any(Date),
        learner: { sections: expect.any(Array) },
      },
    });
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
  });

  it('restores the latest terminal attempt without starting a new one', async () => {
    const { repo, service } = await startAndSubmit(allTypesExam);
    const session = (service as unknown as {
      session(actor: ExamActor, courseId: string, itemId: string): Promise<{
        attemptsUsed: number;
        attempt: ExamStartResult | null;
      }>;
    }).session;

    await expect(session(learner, 'course-1', allTypesExam.id)).resolves.toMatchObject({
      attemptsUsed: 1,
      attempt: { status: 'graded', answers: expect.any(Object) },
    });
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
  });

  it('returns an empty session without drawing or creating an attempt', async () => {
    const { repo, service } = harness(allTypesExam);

    await expect(service.session(learner, 'course-1', allTypesExam.id)).resolves.toEqual({
      attemptsUsed: 0,
      attempt: null,
    });
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(0);
  });

  it('settles an overdue active attempt before returning the session snapshot', async () => {
    const { clock, repo, service } = harness(aiExam);
    const started = await service.start(learner, 'course-1', aiExam.id);
    const attempt = await storedAttempt(repo, started);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.session(learner, 'course-1', aiExam.id)).resolves.toMatchObject({
      attemptsUsed: 1,
      attempt: { attemptId: attempt.id, status: 'expired', late: true },
    });
    expect(await repo.listAttempts(learner.id, aiExam.id)).toHaveLength(1);
  });

  it('atomically resumes one attempt across concurrent start requests', async () => {
    const { repo, service } = harness(allTypesExam);

    const [first, second] = await Promise.all([
      service.start(learner, 'course-1', allTypesExam.id),
      service.start(learner, 'course-1', allTypesExam.id),
    ]);

    expect(second.attemptId).toBe(first.attemptId);
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
  });

  it('uses cumulative section limits as a server deadline when no global limit exists', async () => {
    const item = structuredClone(allTypesExam);
    delete item.grading.exam!.timeLimitMinutes;
    item.grading.exam!.sections.forEach((section, index) => {
      section.timeLimitMinutes = index + 2;
    });
    const { repo, service } = harness(item);

    const started = await service.start(learner, 'course-1', item.id);
    const stored = (await repo.getAttempt(started.attemptId))!;
    const totalMinutes = item.grading.exam!.sections.reduce((sum, section) => sum + section.timeLimitMinutes!, 0);
    const expectedOffsets = item.grading.exam!.sections.reduce<number[]>((offsets, section) => [
      ...offsets,
      (offsets.at(-1) ?? 0) + section.timeLimitMinutes! * 60_000,
    ], []);

    expect(started.deadlineAt).toEqual(new Date(stored.startedAt.getTime() + totalMinutes * 60_000));
    expect(stored.questionSet.sections.map(({ deadlineOffsetMs }) => deadlineOffsetMs)).toEqual(expectedOffsets);
  });

  it('fails closed for legacy mixed section timers even with a global deadline', async () => {
    const item = structuredClone(aiExam);
    item.grading.exam!.timeLimitMinutes = 30;
    item.grading.exam!.sections[0].timeLimitMinutes = 5;
    delete item.grading.exam!.sections[1].timeLimitMinutes;
    const { service } = harness(item);

    await expect(service.start(learner, 'course-1', item.id)).rejects.toMatchObject({
      code: 'INVALID_EXAM_CONFIGURATION',
      httpStatus: 422,
    });
  });

  it('returns learner-safe DTOs from start, resume, and submit', async () => {
    const item = withExamSettings(allTypesExam, {
      review: {
        showScore: 'immediately',
        showCorrectAnswers: 'immediately',
        showExplanations: 'immediately',
        releaseAt: null,
      },
    });
    const { repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    const resumed = await service.start(learner, 'course-1', item.id);

    expect(started).toMatchObject({
      attemptId: attempt.id,
      attemptNo: 1,
      status: 'in_progress',
      late: false,
      startedAt: expect.any(Date),
      deadlineAt: expect.any(Date),
      learner: { sections: expect.any(Array) },
    });
    expect(started).not.toHaveProperty('attempt');
    expect(resumed).toEqual(started);
    assertNoAnswerKeys(started);

    await service.save(learner, attempt.id, answersFor(attempt, true));
    const submitted = await service.submit(learner, attempt.id);
    expect(submitted).toMatchObject({
      attemptId: attempt.id,
      status: 'graded',
      late: false,
      points: 6,
      maxPoints: 6,
      percent: 100,
      passed: true,
      revealed: {
        correctAnswers: expect.any(Object),
        explanations: expect.any(Object),
      },
    });
    expect(submitted).not.toHaveProperty('revealed.optionFeedback');
    expect(submitted).not.toHaveProperty('gradingSnapshot');
    expect(submitted).not.toHaveProperty('questionSet');
    assertNoAnswerKeys(submitted);
  });

  it('defensively strips every canonical grading key from a stored learner render', async () => {
    const item = structuredClone(allTypesExam);
    const section = (item.renders.en.sections as Array<{ questions: Record<string, unknown>[] }>)[0];
    Object.assign(section.questions[0], {
      feedback: 'secret feedback',
      sampleAnswer: 'secret sample',
      sourceRef: 'secret source',
    });
    const { service } = harness(item);

    const started = await service.start(learner, 'course-1', item.id);

    assertNoAnswerKeys(started);
  });

  it('preserves presentation feedback inside engine-skipped learner subtrees', async () => {
    const item = structuredClone(allTypesExam);
    const section = (item.renders.en.sections as Array<{ questions: Record<string, unknown>[] }>)[0];
    section.questions[0].settings = { feedback: 'presentation setting' };
    section.questions[0].display = { explanation: 'presentation hint' };
    const { service } = harness(item);

    const started = await service.start(learner, 'course-1', item.id);
    const learnerSection = started.learner.sections[0] as { questions: Record<string, unknown>[] };

    expect(learnerSection.questions[0]).toMatchObject({
      settings: { feedback: 'presentation setting' },
      display: { explanation: 'presentation hint' },
    });
  });

  it('enforces availability and attempt limits with typed errors', async () => {
    const closed = withExamSettings(allTypesExam, { openAt: '2026-09-03T00:00:00.000Z' });
    const closedHarness = harness(closed);
    await expect(closedHarness.service.start(learner, 'course-1', closed.id))
      .rejects.toMatchObject({ code: 'EXAM_CLOSED', httpStatus: 409 });

    const oneAttempt = withExamSettings(allTypesExam, { attemptsAllowed: 1 });
    const { service } = await startAndSubmit(oneAttempt);
    await expect(service.start(learner, 'course-1', oneAttempt.id))
      .rejects.toMatchObject({ code: 'NO_ATTEMPTS', httpStatus: 409 });
  });

  it('throws a typed error when a drawn question has no requested or default locale render', async () => {
    const repo = new InMemoryExamRepo();
    const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
    const service = createExamService({
      repo,
      clock,
      bank: {
        async listPublished(query: BankListQuery) {
          return (await bankSource.listPublished(query)).map((question) => ({
            ...question,
            renders: {} as never,
          }));
        },
      },
      loadItem: async () => itemContext(aiExam),
      isEnrolled: async () => true,
    });

    await expect(service.start(learner, 'course-1', aiExam.id)).rejects.toMatchObject({
      name: 'ExamError',
      code: 'LOCALE_UNAVAILABLE',
      httpStatus: 409,
    });
  });

  it('allows save and submit through the exact 30-second deadline grace boundary', async () => {
    const { clock, repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_000));

    await expect(service.save(learner, attempt.id, answersFor(attempt, true))).resolves.toBeDefined();
    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'graded' });
  });

  it('rejects answers for a section after its cumulative deadline and grace period', async () => {
    const item = structuredClone(aiExam);
    item.grading.exam!.timeLimitMinutes = 30;
    item.grading.exam!.sections.forEach((section, index) => {
      section.timeLimitMinutes = index + 1;
    });
    const { clock, repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    const firstSection = attempt.questionSet.sections[0];
    const laterSection = attempt.questionSet.sections[1];
    clock.set(new Date(attempt.startedAt.getTime() + firstSection.deadlineOffsetMs! + 30_001));

    await expect(service.save(learner, attempt.id, { [firstSection.questionIds[0]]: 'a' }))
      .rejects.toMatchObject({ code: 'SECTION_DEADLINE_PASSED', httpStatus: 409 });
    await expect(service.save(learner, attempt.id, { [laterSection.questionIds[0]]: 'b' }))
      .resolves.toEqual([expect.objectContaining({ questionId: laterSection.questionIds[0], answer: 'b' })]);
  });

  it('withholds grading records if submission completes between save and response read', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const id = started.attemptId;
    const questionId = (await repo.getAttempt(id))!.questionSet.sections[0].questionIds[0];
    const listAnswers = repo.listAnswers.bind(repo);
    vi.spyOn(repo, 'listAnswers').mockImplementationOnce(() => listAnswers(id)).mockResolvedValueOnce([{
      attemptId: id, questionId, answer: 'learner answer',
      result: { questionId, status: 'correct', points: 1, maxPoints: 1, parts: { secret: 'missing' } },
      manualPoints: 1, manualFeedback: 'Private grading draft', gradedBy: 'instructor', updatedAt: new Date(),
    }]);
    const saved = await service.save(learner, id, { [questionId]: 'learner answer' });
    expect(saved).toEqual([expect.objectContaining({ questionId, answer: 'learner answer', result: null, manualPoints: null, manualFeedback: null, gradedBy: null })]);
  });

  it('rejects saves after grace with DEADLINE_PASSED and forbids non-owners', async () => {
    const { clock, repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attemptId = attemptIdOf(started);

    await expect(service.save(otherLearner, attemptId, {}))
      .rejects.toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
    const attempt = await storedAttempt(repo, started);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));
    await expect(service.save(learner, attemptId, {}))
      .rejects.toMatchObject({ code: 'DEADLINE_PASSED', httpStatus: 409 });
  });

  it('rechecks active enrollment for every learner attempt operation', async () => {
    let enrolled = true;
    const isEnrolled = vi.fn(async () => enrolled);
    const { repo, service } = harness(allTypesExam, undefined, isEnrolled);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    enrolled = false;

    await expect(service.save(learner, attempt.id, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.submit(learner, attempt.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.review(learner, attempt.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.events(learner, attempt.id, [{ type: 'focus_lost' }]))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(isEnrolled).toHaveBeenCalledTimes(4);
    expect(isEnrolled).toHaveBeenCalledWith(learner.id, attempt.courseVersionId);
  });

  it('does not expose the sweep enrollment bypass through public submit at runtime', async () => {
    let enrolled = true;
    const { repo, service } = harness(allTypesExam, undefined, async () => enrolled);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    enrolled = false;
    const runtimeSubmit = service.submit as unknown as (
      actor: ExamActor,
      attemptId: string,
      access: { system: true },
    ) => ReturnType<typeof service.submit>;

    await expect(runtimeSubmit(learner, attempt.id, { system: true }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('expires and scores zero when a reject-policy exam is submitted after grace', async () => {
    const { clock, repo, service } = harness(aiExam);
    const started = await service.start(learner, 'course-1', aiExam.id);
    const attempt = await storedAttempt(repo, started);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.submit(learner, attempt.id))
      .rejects.toMatchObject({ code: 'DEADLINE_PASSED', httpStatus: 409 });
    expect(await repo.getAttempt(attempt.id)).toMatchObject({ status: 'expired', points: 0, percent: 0, late: true });
  });

  it('grades an accepted late auto-graded exam with a separate late flag', async () => {
    const item = withExamSettings(allTypesExam, {
      review: {
        showScore: 'immediately',
        showCorrectAnswers: 'never',
        showExplanations: 'never',
        releaseAt: null,
      },
    });
    const { clock, repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, answersFor(attempt, true));
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'graded', late: true, percent: 100 });
    expect(await repo.getAttempt(attempt.id)).toMatchObject({ status: 'graded', late: true, percent: 100 });
  });

  it('lets only one concurrent submission run terminal effects', async () => {
    const repo = new InMemoryExamRepo();
    const recomputeProgress = vi.fn(async () => undefined);
    const onExamPassed = vi.fn(async () => undefined);
    const awardXp = vi.fn(async () => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress,
      onExamPassed,
      awardXp,
    });
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, answersFor(attempt, true));

    const results = await Promise.allSettled([
      service.submit(learner, attempt.id),
      service.submit(learner, attempt.id),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(recomputeProgress).toHaveBeenCalledOnce();
    expect(onExamPassed).toHaveBeenCalledOnce();
    expect(awardXp).toHaveBeenCalledOnce();
  });

  it('returns the durable terminal result when a submission request is repeated', async () => {
    const { attempt, service, submitted } = await startAndSubmit(allTypesExam);

    await expect(service.submit(learner, attempt.id)).resolves.toEqual(submitted);
  });

  it('reloads and regrades when an accepted save wins just before finalization', async () => {
    const storage = new InMemoryExamRepo();
    let armed = false;
    let blocked = false;
    let releaseRead = () => {};
    let notifyRead = () => {};
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readCaptured = new Promise<void>((resolve) => { notifyRead = resolve; });
    const repo: ExamRepo = {
      getAttempt: (id) => storage.getAttempt(id),
      listAttempts: (...args) => storage.listAttempts(...args),
      insertAttempt: (attempt, attemptsAllowed) => storage.insertAttempt(attempt, attemptsAllowed),
      updateAttempt: (id, patch) => storage.updateAttempt(id, patch),
      saveActiveAnswers: (attemptId, userId, answers) => storage.saveActiveAnswers(attemptId, userId, answers),
      finalizeAttempt: (id, patch, expectedAnswers, resultAnswers) =>
        storage.finalizeAttempt(id, patch, expectedAnswers, resultAnswers),
      saveManualDraft: (attemptId, answer) => storage.saveManualDraft(attemptId, answer),
      completeManualGrading: (id, patch, expectedAnswers, resultAnswers) =>
        storage.completeManualGrading(id, patch, expectedAnswers, resultAnswers),
      releaseAttempt: (id, releasedAt) => storage.releaseAttempt(id, releasedAt),
      upsertAnswers: (answers) => storage.upsertAnswers(answers),
      listAnswers: async (attemptId) => {
        const snapshot = await storage.listAnswers(attemptId);
        if (armed && !blocked) {
          blocked = true;
          notifyRead();
          await readGate;
        }
        return snapshot;
      },
      upsertGrade: (grade) => storage.upsertGrade(grade),
      insertEvents: (events, limit) => storage.insertEvents(events, limit),
      countEvents: (attemptId) => storage.countEvents(attemptId),
      listExpiredInProgress: (now) => storage.listExpiredInProgress(now),
    };
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
    });
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = (await storage.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, answersFor(attempt, true));
    armed = true;

    const submitting = service.submit(learner, attempt.id);
    await readCaptured;
    await service.save(learner, attempt.id, answersFor(attempt, false));
    releaseRead();

    await expect(submitting).resolves.toMatchObject({ status: 'graded', percent: 0 });
    expect((await storage.listAnswers(attempt.id)).map(({ answer }) => answer))
      .toEqual(expect.arrayContaining(Object.values(answersFor(attempt, false))));
  });

  it('resolves an overdue in-progress attempt before returning it from resume', async () => {
    const { clock, repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, answersFor(attempt, true));
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.start(learner, 'course-1', allTypesExam.id)).resolves.toMatchObject({
      attemptId: attempt.id,
      status: 'graded',
      late: true,
    });
    expect(await repo.listAttempts(learner.id, allTypesExam.id)).toHaveLength(1);
  });
});

describe('exam grade aggregation', () => {
  for (const [policy, expected] of [
    ['best', 100],
    ['latest', 100],
    ['first', 0],
    ['average', 50],
  ] as const) {
    it(`applies the ${policy} scoring policy`, async () => {
      const item = withExamSettings(allTypesExam, { attemptsAllowed: 2, scoringPolicy: policy });
      const { repo, service } = harness(item);
      const firstStart = await service.start(learner, 'course-1', item.id);
      const first = await storedAttempt(repo, firstStart);
      await service.save(learner, first.id, answersFor(first, false));
      await service.submit(learner, first.id);
      const secondStart = await service.start(learner, 'course-1', item.id);
      const second = await storedAttempt(repo, secondStart);
      await service.save(learner, second.id, answersFor(second, true));
      await service.submit(learner, second.id);

      expect(repo.getGrade(learner.id, item.id)?.percent).toBe(expected);
    });
  }

  it('excludes an expired attempt from latest-policy aggregation', async () => {
    const item = withExamSettings(allTypesExam, {
      attemptsAllowed: 2,
      lateSubmission: 'reject',
      scoringPolicy: 'latest',
    });
    const { clock, repo, service } = harness(item);
    const firstStart = await service.start(learner, 'course-1', item.id);
    const first = await storedAttempt(repo, firstStart);
    await service.submit(learner, first.id);
    await repo.updateAttempt(first.id, { percent: 90 });

    const secondStart = await service.start(learner, 'course-1', item.id);
    const second = await storedAttempt(repo, secondStart);
    clock.set(new Date(second.deadlineAt!.getTime() + 30_001));
    await expect(service.submit(learner, second.id)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });

    expect(repo.getGrade(learner.id, item.id)?.percent).toBe(90);
  });

  it('sorts attempts defensively before applying an order-sensitive scoring policy', async () => {
    const item = withExamSettings(allTypesExam, { attemptsAllowed: 2, scoringPolicy: 'latest' });
    const storage = new InMemoryExamRepo();
    const unorderedRepo: ExamRepo = {
      getAttempt: (id) => storage.getAttempt(id),
      listAttempts: async (...args) => (await storage.listAttempts(...args)).reverse(),
      insertAttempt: (attempt, attemptsAllowed) => storage.insertAttempt(attempt, attemptsAllowed),
      updateAttempt: (id, patch) => storage.updateAttempt(id, patch),
      saveActiveAnswers: (attemptId, userId, answers) => storage.saveActiveAnswers(attemptId, userId, answers),
      finalizeAttempt: (id, patch, expectedAnswers, resultAnswers) =>
        storage.finalizeAttempt(id, patch, expectedAnswers, resultAnswers),
      saveManualDraft: (attemptId, answer) => storage.saveManualDraft(attemptId, answer),
      completeManualGrading: (id, patch, expectedAnswers, resultAnswers) =>
        storage.completeManualGrading(id, patch, expectedAnswers, resultAnswers),
      releaseAttempt: (id, releasedAt) => storage.releaseAttempt(id, releasedAt),
      upsertAnswers: (answers) => storage.upsertAnswers(answers),
      listAnswers: (attemptId) => storage.listAnswers(attemptId),
      upsertGrade: (grade) => storage.upsertGrade(grade),
      insertEvents: (events, limit) => storage.insertEvents(events, limit),
      countEvents: (attemptId) => storage.countEvents(attemptId),
      listExpiredInProgress: (now) => storage.listExpiredInProgress(now),
    };
    const service = createExamService({
      repo: unorderedRepo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(item),
      isEnrolled: async () => true,
    });
    const first = await service.start(learner, 'course-1', item.id);
    const firstAttempt = (await storage.getAttempt(first.attemptId))!;
    await service.save(learner, first.attemptId, answersFor(firstAttempt, false));
    await service.submit(learner, first.attemptId);
    const second = await service.start(learner, 'course-1', item.id);
    const secondAttempt = (await storage.getAttempt(second.attemptId))!;
    await service.save(learner, second.attemptId, answersFor(secondAttempt, true));
    await service.submit(learner, second.attemptId);

    expect(storage.getGrade(learner.id, item.id)?.percent).toBe(100);
  });

  it('does not create an aggregate grade when the learner has only an expired attempt', async () => {
    const item = withExamSettings(allTypesExam, { lateSubmission: 'reject' });
    const { clock, repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.submit(learner, attempt.id)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    expect(repo.getGrade(learner.id, item.id)).toBeNull();
  });
});

describe('exam review release policy', () => {
  it('withholds a saved manual draft and publishes localized feedback on completion, without revealing the key', async () => {
    const item = withExamSettings(aiExam, {
      review: {
        showScore: 'never',
        showCorrectAnswers: 'never',
        showExplanations: 'never',
        releaseAt: null,
      },
    });
    const { repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, { ...answersFor(attempt, true), 's2/e2': 'Manual answer' });
    await service.submit(learner, attempt.id);
    await service.manualGrade(instructor, attempt.id, 's2/e2', 2, {
      vi: 'Phản hồi riêng',
      en: 'Specific feedback',
    });

    // A saved draft exposes nothing: no feedback, no score, not even a partial one.
    const draft = await service.review(learner, attempt.id);
    expect(draft).not.toHaveProperty('manualFeedback');
    expect(draft).not.toHaveProperty('score');
    expect(draft).not.toHaveProperty('results');
    expect((await repo.getAttempt(attempt.id))?.status).toBe('pending_manual');

    const { transitioned } = await service.completeGrading(instructor, attempt.id);
    expect(transitioned).toBe(true);

    // Completion publishes score and feedback despite `showScore: 'never'`, and
    // still leaves the answer key sealed because nothing was released.
    const completed = await service.review(learner, attempt.id);
    expect(completed).toMatchObject({
      released: false,
      manualFeedback: { 's2/e2': 'Specific feedback' },
    });
    expect(completed.score).toBeDefined();
    expect(completed.revealed.correctAnswers).toBeUndefined();
    expect(completed.revealed.explanations).toBeUndefined();
  });

  for (const mode of ['immediately', 'on_release', 'never'] as const) {
    it(`${mode} reveals score, answers, and explanations only when its policy permits`, async () => {
      const review = { showScore: mode, showCorrectAnswers: mode, showExplanations: mode, releaseAt: null };
      const item = withExamSettings(allTypesExam, { review });
      const { attempt, service } = await startAndSubmit(item);

      // Automatic grading completed on submit, so the score is the learner's under
      // every legacy `showScore` mode. The answer key still obeys its own policy.
      const before = await service.review(learner, attempt.id);
      expect(Boolean(before.score)).toBe(true);
      expect(Object.hasOwn(before, 'results')).toBe(mode === 'immediately');
      expect(Boolean(before.revealed.correctAnswers)).toBe(mode === 'immediately');
      expect(Boolean(before.revealed.explanations)).toBe(mode === 'immediately');

      await service.release(instructor, { attemptId: attempt.id });
      const after = await service.review(learner, attempt.id);
      const visibleAfterRelease = mode !== 'never';
      expect(Boolean(after.score)).toBe(true);
      expect(Object.hasOwn(after, 'results')).toBe(visibleAfterRelease);
      expect(Boolean(after.revealed.correctAnswers)).toBe(visibleAfterRelease);
      expect(Boolean(after.revealed.explanations)).toBe(visibleAfterRelease);
    });
  }

  it('honors a scheduled release without mutating the stored attempt', async () => {
    const releaseAt = '2026-09-02T01:00:00.000Z';
    const item = withExamSettings(allTypesExam, {
      review: { showScore: 'on_release', showCorrectAnswers: 'on_release', showExplanations: 'on_release', releaseAt },
    });
    const { attempt, clock, repo, service } = await startAndSubmit(item);
    clock.set(releaseAt);

    expect(await service.review(learner, attempt.id)).toMatchObject({ released: true, score: { percent: 100 }, late: false });
    expect(JSON.stringify((await service.review(learner, attempt.id)).results)).toContain('parts');
    expect((await repo.getAttempt(attempt.id))?.releasedAt).toBeNull();
  });

  it('applies mixed score, answer, and explanation reveal policies independently', async () => {
    const item = withExamSettings(allTypesExam, {
      review: {
        showScore: 'immediately',
        showCorrectAnswers: 'never',
        showExplanations: 'on_release',
        releaseAt: null,
      },
    });
    const { attempt, service, submitted } = await startAndSubmit(item);

    expect(submitted).toMatchObject({ points: 6, maxPoints: 6, percent: 100, passed: true });
    expect(submitted).not.toHaveProperty('revealed.correctAnswers');
    expect(submitted).not.toHaveProperty('revealed.explanations');
    const before = await service.review(learner, attempt.id);
    expect(before.score?.percent).toBe(100);
    expect(JSON.stringify(before.results)).not.toContain('parts');
    expect(before.revealed.correctAnswers).toBeUndefined();
    expect(before.revealed.explanations).toBeUndefined();

    await service.release(instructor, { attemptId: attempt.id });
    const after = await service.review(learner, attempt.id);
    expect(after.score?.percent).toBe(100);
    expect(JSON.stringify(after.results)).not.toContain('parts');
    expect(after.revealed.correctAnswers).toBeUndefined();
    expect(after.revealed.explanations).toBeDefined();
  });

  it('returns learner answers without per-question status or points for a historical withheld attempt', async () => {
    const item = withExamSettings(allTypesExam, {
      review: {
        showScore: 'never',
        showCorrectAnswers: 'immediately',
        showExplanations: 'never',
        releaseAt: null,
      },
    });
    const { attempt, repo, service } = await startAndSubmit(item);
    // Reproduce a row written before result availability existed: graded, never
    // released, no availability timestamp. It must keep its old projection exactly.
    await repo.updateAttempt(attempt.id, { resultAvailableAt: null });

    const review = await service.review(learner, attempt.id);

    expect(review).toMatchObject({ late: false, answers: expect.any(Object) });
    expect(review).not.toHaveProperty('results');
    expect(review).not.toHaveProperty('score');
    expect(Object.keys(review.answers)).not.toHaveLength(0);
  });
});

describe('manual grading, sweep, and integrity events', () => {
  it('runs the injected progress recompute hook after submit and manual grading', async () => {
    const repo = new InMemoryExamRepo();
    const recomputeProgress = vi.fn(async () => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(aiExam),
      isEnrolled: async () => true,
      recomputeProgress,
    });
    const started = await service.start(learner, 'course-1', aiExam.id);
    const attempt = (await repo.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, { ...answersFor(attempt, true), 's2/e2': 'A reasoned response.' });

    await service.submit(learner, attempt.id);
    // A draft save must not recompute progress: nothing about the learner changed.
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Good.' });
    expect(recomputeProgress).toHaveBeenCalledTimes(1);
    await service.completeGrading(instructor, attempt.id);

    expect(recomputeProgress).toHaveBeenCalledTimes(2);
    expect(recomputeProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: attempt.id, status: 'pending_manual' }));
    expect(recomputeProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: attempt.id, status: 'graded' }));
  });

  it('returns the graded submit DTO when post-commit progress recompute fails', async () => {
    const repo = new InMemoryExamRepo();
    const failure = new Error('progress unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress: async () => { throw failure; },
    });

    try {
      const started = await service.start(learner, 'course-1', allTypesExam.id);
      const attempt = await storedAttempt(repo, started);
      await service.save(learner, attempt.id, answersFor(attempt, true));

      await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({
        attemptId: attempt.id,
        status: 'graded',
        points: 6,
        maxPoints: 6,
        percent: 100,
        passed: true,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'Exam post-commit side effect failed',
        expect.objectContaining({
          effect: 'progress.recompute',
          attemptId: attempt.id,
          courseVersionId: attempt.courseVersionId,
          correlationId: expect.any(String),
          error: failure,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns the durable manual grade when post-commit progress recompute fails', async () => {
    const repo = new InMemoryExamRepo();
    const failure = new Error('progress unavailable');
    const recomputeProgress = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(aiExam),
      isEnrolled: async () => true,
      recomputeProgress,
    });

    try {
      const started = await service.start(learner, 'course-1', aiExam.id);
      const attempt = await storedAttempt(repo, started);
      await service.save(learner, attempt.id, {
        ...answersFor(attempt, true),
        's2/e2': 'A responsible study use with a clear limitation.',
      });
      await service.submit(learner, attempt.id);

      await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Good.' });
      await expect(service.completeGrading(instructor, attempt.id))
        .resolves.toMatchObject({
          transitioned: true,
          attempt: { id: attempt.id, status: 'graded', points: 11, percent: 91.67 },
        });
      expect(recomputeProgress).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(
        'Exam post-commit side effect failed',
        expect.objectContaining({
          effect: 'progress.recompute',
          attemptId: attempt.id,
          courseVersionId: attempt.courseVersionId,
          correlationId: expect.any(String),
          error: failure,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns the durable release when post-commit progress recompute fails', async () => {
    const repo = new InMemoryExamRepo();
    const failure = new Error('progress unavailable');
    const recomputeProgress = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress,
    });

    try {
      const started = await service.start(learner, 'course-1', allTypesExam.id);
      const attempt = await storedAttempt(repo, started);
      await service.submit(learner, attempt.id);

      await expect(service.release(instructor, { attemptId: attempt.id })).resolves.toMatchObject({
        released: [{ attemptId: attempt.id }],
      });
      expect(recomputeProgress).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(
        'Exam post-commit side effect failed',
        expect.objectContaining({
          effect: 'progress.recompute',
          attemptId: attempt.id,
          courseVersionId: attempt.courseVersionId,
          correlationId: expect.any(String),
          error: failure,
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('completes a pending-manual attempt after its final manual result', async () => {
    const { repo, service } = harness(aiExam);
    const started = await service.start(learner, 'course-1', aiExam.id);
    const attempt = await storedAttempt(repo, started);
    const answers = answersFor(attempt, true);
    answers['s2/e2'] = 'A responsible study use with a clear limitation.';
    await service.save(learner, attempt.id, answers);
    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'pending_manual' });

    // The draft stores the score without finalizing or aggregating it.
    const drafted = await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Good trade-off.' });
    expect(drafted).toMatchObject({ status: 'pending_manual', resultAvailableAt: null });
    expect((await repo.listAnswers(attempt.id)).find((answer) => answer.questionId === 's2/e2'))
      .toMatchObject({ manualPoints: 3, gradedBy: instructor.id, result: { points: 3, maxPoints: 4 } });
    expect(repo.getGrade(learner.id, aiExam.id)).toBeNull();

    const { attempt: graded, transitioned } = await service.completeGrading(instructor, attempt.id);
    expect(transitioned).toBe(true);
    expect(graded).toMatchObject({ status: 'graded', points: 11, maxPoints: 12, percent: 91.67 });
    expect(graded.resultAvailableAt).toEqual(new Date('2026-09-02T00:00:00.000Z'));
    expect(graded.releasedAt).toBeNull();
    expect(repo.getGrade(learner.id, aiExam.id)?.percent).toBe(91.67);
  });

  it('grades a manual child inside a question group without losing its auto-graded sibling', async () => {
    const item = withManualQuestionGroup(allTypesExam);
    const { repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, {
      ...answersFor(attempt, false),
      's1/x1': {
        auto: ['inline', 'ref', 'pool'],
        essay: 'A concrete risk with a mitigation.',
      },
    });
    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'pending_manual' });

    await service.manualGrade(instructor, attempt.id, 's1/x1/essay', 3, { en: 'Specific.' });
    const { attempt: graded } = await service.completeGrading(instructor, attempt.id);
    expect(graded).toMatchObject({ status: 'graded', points: 5, maxPoints: 10, percent: 50 });
    const parent = (await repo.listAnswers(attempt.id)).find((answer) => answer.questionId === 's1/x1');
    expect(parent?.result).toMatchObject({
      points: 5,
      maxPoints: 6,
      children: [
        { questionId: 's1/x1/auto', points: 2, maxPoints: 2 },
        { questionId: 's1/x1/essay', points: 3, maxPoints: 4 },
      ],
    });
  });

  it('preserves the late flag while a late manual attempt is completed', async () => {
    const item = withExamSettings(aiExam, { lateSubmission: 'accept_flagged' });
    const { clock, repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    const answers = answersFor(attempt, true);
    answers['s2/e2'] = 'A responsible study use with a clear limitation.';
    await service.save(learner, attempt.id, answers);
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'pending_manual', late: true });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Good trade-off.' });
    const { attempt: graded } = await service.completeGrading(instructor, attempt.id);
    expect(graded).toMatchObject({ status: 'graded', late: true });
    await expect(service.review(learner, attempt.id)).resolves.toMatchObject({ late: true });
  });

  it('auto-submits overdue attempts idempotently during repeated sweeps', async () => {
    const { clock, repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, answersFor(attempt, true));
    clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(service.sweepExpired()).resolves.toEqual([{ attemptId: attempt.id, status: 'graded' }]);
    await expect(service.sweepExpired()).resolves.toEqual([]);
  });

  it('auto-submits expired attempts after a learner loses enrollment and continues sweeping', async () => {
    const { clock, service } = harness(
      allTypesExam,
      '2026-09-02T00:00:00.000Z',
      async (userId) => userId !== learner.id,
    );
    const first = await service.start(learner, 'course-1', allTypesExam.id);
    const second = await service.start(otherLearner, 'course-1', allTypesExam.id);
    clock.set(new Date(first.deadlineAt!.getTime() + 30_001));

    await expect(service.sweepExpired()).resolves.toEqual([
      { attemptId: first.attemptId, status: 'graded' },
      { attemptId: second.attemptId, status: 'graded' },
    ]);
  });

  it('stores at most 500 integrity events per attempt', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attemptId = attemptIdOf(started);
    const incoming = Array.from({ length: 501 }, () => ({ type: 'focus_lost' as const, meta: { source: 'window' } }));

    await expect(service.events(learner, attemptId, incoming)).resolves.toEqual({ accepted: 500, dropped: 1 });
    await expect(service.events(learner, attemptId, incoming.slice(0, 1))).resolves.toEqual({ accepted: 0, dropped: 1 });
    expect(await repo.countEvents(attemptId)).toBe(500);
  });

  it('admits at most 500 integrity events across concurrent batches', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const batch = Array.from({ length: 300 }, () => ({ type: 'focus_lost' as const }));

    const results = await Promise.all([
      service.events(learner, started.attemptId, batch),
      service.events(learner, started.attemptId, batch),
    ]);

    expect(results.reduce((sum, result) => sum + result.accepted, 0)).toBe(500);
    expect(await repo.countEvents(started.attemptId)).toBe(500);
  });

  it('rejects invalid event timestamps and clamps timestamps to the attempt lifetime', async () => {
    const { clock, repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attemptId = attemptIdOf(started);

    await expect(service.events(learner, attemptId, [
      { type: 'focus_lost', at: new Date('invalid') },
    ])).rejects.toBeInstanceOf(RangeError);
    expect(repo.listEvents(attemptId)).toHaveLength(0);

    const now = clock.now();
    await service.events(learner, attemptId, [
      { type: 'focus_lost', at: new Date(started.startedAt.getTime() - 60_000) },
      { type: 'focus_gained', at: new Date(now.getTime() + 60_000) },
    ]);
    expect(repo.listEvents(attemptId).map(({ at }) => at)).toEqual([started.startedAt, now]);
  });
});

describe('item-level release authorization', () => {
  it('preserves the first release timestamp and reports a repeated release separately', async () => {
    const repo = new InMemoryExamRepo();
    const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
    const recomputeProgress = vi.fn(async () => undefined);
    const service = createExamService({
      repo,
      clock,
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress,
    });
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    await service.submit(learner, started.attemptId);
    const effectsBeforeRelease = recomputeProgress.mock.calls.length;

    const first = await service.release(instructor, { attemptId: started.attemptId });
    const firstTimestamp = (await repo.getAttempt(started.attemptId))?.releasedAt;
    clock.set(new Date('2026-09-02T01:00:00.000Z'));
    const repeated = await service.release(instructor, { attemptId: started.attemptId });

    expect(first.released).toEqual([{ attemptId: started.attemptId, releasedAt: firstTimestamp }]);
    expect(repeated).toEqual({
      released: [],
      skipped: { forbidden: 0, unassigned: 0, alreadyReleased: [started.attemptId], notReleasable: [] },
    });
    expect((await repo.getAttempt(started.attemptId))?.releasedAt).toEqual(firstTimestamp);
    expect(recomputeProgress).toHaveBeenCalledTimes(effectsBeforeRelease + 1);
  });

  it('runs release effects only for the winner of concurrent requests', async () => {
    const repo = new InMemoryExamRepo();
    const recomputeProgress = vi.fn(async () => undefined);
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress,
    });
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    await service.submit(learner, started.attemptId);
    const effectsBeforeRelease = recomputeProgress.mock.calls.length;

    const results = await Promise.all([
      service.release(instructor, { attemptId: started.attemptId }),
      service.release(instructor, { attemptId: started.attemptId }),
    ]);

    expect(results.flatMap((result) => result.released)).toHaveLength(1);
    expect(results.flatMap((result) => result.skipped.alreadyReleased ?? [])).toEqual([started.attemptId]);
    expect(recomputeProgress).toHaveBeenCalledTimes(effectsBeforeRelease + 1);
  });

  it('keeps pending-manual attempts awaiting grading instead of releasing them', async () => {
    const { repo, service } = harness(aiExam);
    const started = await service.start(learner, 'course-1', aiExam.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, { ...answersFor(attempt, true), 's2/e2': 'Manual answer' });
    await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({ status: 'pending_manual' });

    const released = await service.release(instructor, { attemptId: attempt.id });

    expect(released).toEqual({
      released: [],
      skipped: { forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [attempt.id] },
    });
    expect((await repo.getAttempt(attempt.id))?.releasedAt).toBeNull();
  });

  it('does not activate a scheduled release before manual grading completes', async () => {
    const item = withExamSettings(aiExam, {
      review: {
        showScore: 'on_release',
        showCorrectAnswers: 'on_release',
        showExplanations: 'on_release',
        releaseAt: '2026-09-01T00:00:00.000Z',
      },
    });
    const { repo, service } = harness(item);
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = await storedAttempt(repo, started);
    await service.save(learner, attempt.id, { ...answersFor(attempt, true), 's2/e2': 'Manual answer' });
    await service.submit(learner, attempt.id);

    const review = await service.review(learner, attempt.id);

    expect(review).toMatchObject({ status: 'pending_manual', released: false });
    expect(review).not.toHaveProperty('score');
    expect(review.revealed.correctAnswers).toBeUndefined();
    expect(review.revealed.explanations).toBeUndefined();
  });

  it('releases all attempts for an item and rejects actors without exam.release', async () => {
    const item = withExamSettings(allTypesExam, { attemptsAllowed: 2 });
    const { repo, service } = harness(item);
    const firstStart = await service.start(learner, 'course-1', item.id);
    const first = await storedAttempt(repo, firstStart);
    await service.submit(learner, first.id);
    const secondActor: ExamActor = { ...learner, id: 'learner-3' };
    const secondStart = await service.start(secondActor, 'course-1', item.id);
    const second = await storedAttempt(repo, secondStart);
    await service.submit(secondActor, second.id);

    const courseVersionId = `version-${item.id}`;
    await expect(service.release(learner, { itemId: item.id, courseVersionId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const released = await service.release(instructor, { itemId: item.id, courseVersionId });
    expect(released.released.map((entry) => entry.attemptId).sort()).toEqual([first.id, second.id].sort());
    expect(released.skipped).toEqual({ forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [] });
    expect((await repo.getAttempt(first.id))?.releasedAt).toBeInstanceOf(Date);
    expect((await repo.getAttempt(second.id))?.releasedAt).toBeInstanceOf(Date);
  });

  it('skips in-progress attempts during item-level release', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    const attempt = await storedAttempt(repo, started);

    const result = await service.release(instructor, {
      itemId: allTypesExam.id,
      courseVersionId: `version-${allTypesExam.id}`,
    });

    expect(result.released).toEqual([]);
    expect(result.skipped).toEqual({ forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [attempt.id] });
    expect((await repo.getAttempt(attempt.id))?.releasedAt).toBeNull();
  });

  it('releases only authorized branches and reports other branch attempts as skipped', async () => {
    const { repo, service } = harness(allTypesExam);
    const branchOneLearner: ExamActor = { ...learner, id: 'branch-one-learner' };
    const branchTwoLearner: ExamActor = { ...learner, id: 'branch-two-learner' };
    const firstStart = await service.start(branchOneLearner, 'course-1', allTypesExam.id);
    const first = await storedAttempt(repo, firstStart);
    await service.submit(branchOneLearner, first.id);
    await repo.updateAttempt(first.id, { branchId: 'branch-one' });
    const secondStart = await service.start(branchTwoLearner, 'course-1', allTypesExam.id);
    const second = await storedAttempt(repo, secondStart);
    await service.submit(branchTwoLearner, second.id);
    await repo.updateAttempt(second.id, { branchId: 'branch-two' });
    const branchInstructor: ExamActor = {
      id: 'branch-instructor',
      locale: 'en',
      permissions: ['exam.release'],
      branchId: 'branch-one',
    };

    const result = await service.release(branchInstructor, {
      itemId: allTypesExam.id,
      courseVersionId: `version-${allTypesExam.id}`,
    });

    expect(result.released.map((entry) => entry.attemptId)).toEqual([first.id]);
    expect(result.skipped).toEqual({ forbidden: 1, unassigned: 0, alreadyReleased: [], notReleasable: [] });
    expect((await repo.getAttempt(first.id))?.releasedAt).toBeInstanceOf(Date);
    expect((await repo.getAttempt(second.id))?.releasedAt).toBeNull();
  });

  it('does not leak a forbidden expired attempt id and labels authorized expired attempts not releasable', async () => {
    const { repo, service } = harness(allTypesExam);
    const allowed = await service.start({ ...learner, id: 'allowed-learner' }, 'course-1', allTypesExam.id);
    const forbidden = await service.start({ ...learner, id: 'forbidden-learner' }, 'course-1', allTypesExam.id);
    await repo.updateAttempt(allowed.attemptId, { branchId: 'branch-one', status: 'expired' });
    await repo.updateAttempt(forbidden.attemptId, { branchId: 'branch-two', status: 'expired' });
    const branchInstructor: ExamActor = {
      id: 'branch-instructor',
      locale: 'en',
      permissions: ['exam.release'],
      branchId: 'branch-one',
    };

    const result = await service.release(branchInstructor, {
      itemId: allTypesExam.id,
      courseVersionId: `version-${allTypesExam.id}`,
    });

    expect(result).toEqual({
      released: [],
      skipped: { forbidden: 1, unassigned: 0, alreadyReleased: [], notReleasable: [allowed.attemptId] },
    });
    expect(JSON.stringify(result)).not.toContain(forbidden.attemptId);
  });

  it('counts unassigned learners for branch actors and allows scoped global actors to release them', async () => {
    const { repo, service } = harness(allTypesExam);
    const started = await service.start(learner, 'course-1', allTypesExam.id);
    await service.submit(learner, started.attemptId);
    const target = {
      itemId: allTypesExam.id,
      courseVersionId: `version-${allTypesExam.id}`,
    };
    const branchInstructor: ExamActor = {
      id: 'branch-instructor',
      locale: 'en',
      permissions: ['exam.release'],
      branchId: 'branch-one',
    };

    await expect(service.release(branchInstructor, target)).resolves.toEqual({
      released: [],
      skipped: { forbidden: 0, unassigned: 1, alreadyReleased: [], notReleasable: [] },
    });
    expect((await repo.getAttempt(started.attemptId))?.releasedAt).toBeNull();

    const globalActor: ExamActor = { ...branchInstructor, global: true };
    await expect(service.release(globalActor, target)).resolves.toMatchObject({
      released: [{ attemptId: started.attemptId }],
      skipped: { forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [] },
    });
  });

  it('item-level release never crosses course-version boundaries', async () => {
    const { repo, service } = harness(allTypesExam);
    const current = await service.start(learner, 'course-1', allTypesExam.id);
    await service.submit(learner, current.attemptId);
    const previous = (await repo.getAttempt(current.attemptId))!;
    await repo.insertAttempt({
      ...previous,
      id: crypto.randomUUID(),
      userId: 'previous-version-learner',
      courseVersionId: 'previous-course-version',
      attemptNo: 1,
      releasedAt: null,
    }, 1);

    const result = await service.release(instructor, {
      itemId: allTypesExam.id,
      courseVersionId: `version-${allTypesExam.id}`,
    });

    expect(result.released.map(({ attemptId }) => attemptId)).toEqual([current.attemptId]);
    expect((await repo.listAttempts(null, allTypesExam.id, 'previous-course-version'))[0]?.releasedAt).toBeNull();
  });

  it('keeps a graded passing exam successful when progress and XP hooks fail', async () => {
    const repo = new InMemoryExamRepo();
    const recomputeProgress = vi.fn().mockRejectedValue(new Error('progress unavailable'));
    const awardXp = vi.fn().mockRejectedValue(new Error('xp unavailable'));
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date('2026-09-02T00:00:00.000Z')),
      bank: bankSource,
      loadItem: async () => itemContext(allTypesExam),
      isEnrolled: async () => true,
      recomputeProgress,
      awardXp,
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const started = await service.start(learner, 'course-1', allTypesExam.id);
      const attempt = (await repo.getAttempt(started.attemptId))!;
      await service.save(learner, attempt.id, answersFor(attempt, true));
      await expect(service.submit(learner, attempt.id)).resolves.toMatchObject({
        status: 'graded', passed: true,
      });
      expect(recomputeProgress).toHaveBeenCalledOnce();
      expect(awardXp).toHaveBeenCalledWith(expect.objectContaining({ id: attempt.id }));
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});

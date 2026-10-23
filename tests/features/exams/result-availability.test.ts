import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(async () => undefined) }));
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import type { ExamActor, ExamAttemptRecord, ExamRepo } from '@/features/exams/types';
import {
  bankSource,
  compileExamFixtures,
  instructor,
  itemContext,
  learner,
  MutableClock,
  withExamSettings,
} from './test-kit';

let aiExam: CompiledItem;
let allTypesExam: CompiledItem;

const AT = '2026-09-02T00:00:00.000Z';
const SEALED = {
  showScore: 'never',
  showCorrectAnswers: 'never',
  showExplanations: 'never',
  releaseAt: null,
} as const;

beforeAll(async () => {
  ({ ai: aiExam, all: allTypesExam } = await compileExamFixtures());
});

/** Delegates every repo call to `storage`; class methods live on the prototype, so
 *  they cannot be spread into a plain object. */
function delegate(storage: InMemoryExamRepo, overrides: Partial<ExamRepo> = {}): ExamRepo {
  return {
    getAttempt: (id) => storage.getAttempt(id),
    listAttempts: (...args) => storage.listAttempts(...args),
    insertAttempt: (attempt, allowed) => storage.insertAttempt(attempt, allowed),
    updateAttempt: (id, patch) => storage.updateAttempt(id, patch),
    saveActiveAnswers: (id, userId, answers) => storage.saveActiveAnswers(id, userId, answers),
    finalizeAttempt: (id, patch, expected, results) => storage.finalizeAttempt(id, patch, expected, results),
    saveManualDraft: (id, answer) => storage.saveManualDraft(id, answer),
    completeManualGrading: (id, patch, expected, results) =>
      storage.completeManualGrading(id, patch, expected, results),
    releaseAttempt: (id, at) => storage.releaseAttempt(id, at),
    upsertAnswers: (answers) => storage.upsertAnswers(answers),
    listAnswers: (id) => storage.listAnswers(id),
    upsertGrade: (grade) => storage.upsertGrade(grade),
    insertEvents: (events, limit) => storage.insertEvents(events, limit),
    countEvents: (id) => storage.countEvents(id),
    listExpiredInProgress: (now) => storage.listExpiredInProgress(now),
    ...overrides,
  };
}

function harness(item: CompiledItem, at = AT, overrides: Partial<ExamRepo> = {}) {
  const storage = new InMemoryExamRepo();
  const repo = delegate(storage, overrides);
  const clock = new MutableClock(new Date(at));
  const recomputeProgress = vi.fn(async () => undefined);
  const service = createExamService({
    repo,
    clock,
    bank: bankSource,
    loadItem: async (_actor, _courseId, itemId) => itemId === item.id ? itemContext(item) : null,
    isEnrolled: async () => true,
    recomputeProgress,
  });
  return { storage, repo, clock, service, recomputeProgress };
}

function answersFor(attempt: ExamAttemptRecord, correct: boolean): Record<string, unknown> {
  return Object.fromEntries(attempt.questionSet.sections.flatMap((section) => section.questionIds.map((id) => [
    id,
    id === 's1/x1'
      ? correct ? ['inline', 'ref', 'pool'] : ['lesson']
      : correct ? 'a' : 'b',
  ])));
}

/** Starts an attempt, answers it, submits it and returns the stored attempt. */
async function submitted(
  item: CompiledItem,
  { manual, at = AT }: { manual?: string; at?: string } = {},
) {
  const h = harness(item, at);
  const started = await h.service.start(learner, 'course-1', item.id);
  const attempt = (await h.storage.getAttempt(started.attemptId))!;
  const answers = answersFor(attempt, true);
  if (manual) answers[manual] = 'A responsible study use with a clear limitation.';
  await h.service.save(learner, attempt.id, answers);
  const result = await h.service.submit(learner, attempt.id);
  return { ...h, attempt, result };
}

/** An exam whose grading needs a human: `s2/e2` is a manually scored essay. */
const manualExam = (patch: Partial<NonNullable<CompiledItem['grading']['exam']>> = {}) =>
  withExamSettings(aiExam, { review: { ...SEALED }, ...patch });

describe('automatic result availability', () => {
  it('returns the new aggregate score without a per-question answer oracle when review is sealed', async () => {
    const { attempt, service } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));
    const review = await service.review(learner, attempt.id);
    expect(review.score).toMatchObject({ points: 6, maxPoints: 6, percent: 100 });
    expect(review.resultsAvailable).toBe(true);
    expect(review).not.toHaveProperty('results');
    expect(review.revealed).toEqual({});
  });

  it('opens the per-question breakdown only when the pinned review policy permits it', async () => {
    const { attempt, service } = await submitted(withExamSettings(allTypesExam, {
      review: { ...SEALED, showCorrectAnswers: 'on_release' },
    }));
    expect(await service.review(learner, attempt.id)).not.toHaveProperty('results');
    await service.release(instructor, { attemptId: attempt.id });
    expect((await service.review(learner, attempt.id)).results).not.toHaveLength(0);
  });

  it('publishes the score in the same transition that grades an automatic submission', async () => {
    const { attempt, storage, result } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));

    const stored = (await storage.getAttempt(attempt.id))!;
    expect(stored.status).toBe('graded');
    expect(stored.resultAvailableAt).toEqual(new Date(AT));
    expect(stored.submittedAt).toEqual(new Date(AT));
    // `showScore: 'never'` cannot withhold a result the learner now owns...
    expect(result).toMatchObject({ points: 6, maxPoints: 6, percent: 100, passed: true });
    // ...and availability grants nothing about the answer key.
    expect(stored.releasedAt).toBeNull();
    expect(result).not.toHaveProperty('revealed');
  });

  it('publishes nothing for an attempt that still needs manual grading', async () => {
    const { attempt, storage, result } = await submitted(manualExam(), { manual: 's2/e2' });

    const stored = (await storage.getAttempt(attempt.id))!;
    expect(stored.status).toBe('pending_manual');
    expect(stored.resultAvailableAt).toBeNull();
    expect(result).toMatchObject({ points: null, maxPoints: null, percent: null, passed: null });
  });

  it('withholds the partial auto score of a mixed attempt configured to show scores immediately', async () => {
    const item = manualExam({
      review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never', releaseAt: null },
    });
    const { attempt, service, result } = await submitted(item, { manual: 's2/e2' });

    // The attempt has real auto-graded points stored, but publishing them here
    // would be a partial score for an attempt whose grading has not finished.
    expect(result.points).toBeNull();
    const review = await service.review(learner, attempt.id);
    expect(review).not.toHaveProperty('score');
    expect(review).not.toHaveProperty('results');
  });

  it('publishes nothing for a rejected late submission', async () => {
    const item = withExamSettings(allTypesExam, { lateSubmission: 'reject', review: { ...SEALED } });
    const h = harness(item);
    const started = await h.service.start(learner, 'course-1', item.id);
    const attempt = (await h.storage.getAttempt(started.attemptId))!;
    await h.service.save(learner, attempt.id, answersFor(attempt, true));
    h.clock.set(new Date(attempt.deadlineAt!.getTime() + 30_001));

    await expect(h.service.submit(learner, attempt.id)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    const stored = (await h.storage.getAttempt(attempt.id))!;
    expect(stored.status).toBe('expired');
    expect(stored.resultAvailableAt).toBeNull();
  });

  it('leaves a historical graded attempt hidden and still releasable', async () => {
    const { attempt, storage, service } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));
    // Reproduce a row written before the column existed.
    await storage.updateAttempt(attempt.id, { resultAvailableAt: null });

    expect(await service.review(learner, attempt.id)).not.toHaveProperty('score');
    const released = await service.release(instructor, { attemptId: attempt.id });

    expect(released.released).toEqual([{ attemptId: attempt.id, releasedAt: new Date(AT) }]);
    // The legacy operation publishes the key, never result availability.
    expect((await storage.getAttempt(attempt.id))?.resultAvailableAt).toBeNull();
  });
});

describe('reported score availability', () => {
  it('reports availability for a newly completed automatic attempt', async () => {
    const { attempt, service } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));

    const review = await service.review(learner, attempt.id);

    expect(review.resultsAvailable).toBe(true);
    expect(review.score).toBeDefined();
    // Availability is about the score only; the key stays sealed.
    expect(review.released).toBe(false);
    expect(review.revealed.correctAnswers).toBeUndefined();
  });

  it('reports availability for a historical attempt whose pinned policy shows the score', async () => {
    // The legacy visible case: no availability timestamp, but `showScore` already
    // made the score visible. Reporting `false` here would contradict the screen.
    const item = withExamSettings(allTypesExam, {
      review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never', releaseAt: null },
    });
    const { attempt, storage, service } = await submitted(item);
    await storage.updateAttempt(attempt.id, { resultAvailableAt: null });

    const review = await service.review(learner, attempt.id);

    expect(review.resultsAvailable).toBe(true);
    expect(review.score).toEqual({ points: 6, maxPoints: 6, percent: 100 });
    expect(Object.hasOwn(review, 'results')).toBe(true);
  });

  it('reports no availability for a historical attempt whose pinned policy withholds the score', async () => {
    // The legacy hidden case, unchanged from before this work.
    const { attempt, storage, service } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));
    await storage.updateAttempt(attempt.id, { resultAvailableAt: null });

    const review = await service.review(learner, attempt.id);

    expect(review.resultsAvailable).toBe(false);
    expect(review).not.toHaveProperty('score');
    expect(review).not.toHaveProperty('results');
  });

  it('keeps manual feedback on completed grading rather than on the legacy score policy', async () => {
    // A historical attempt with a visible score still withholds manual feedback:
    // `showScore` says nothing about whether a grader's comments were finished.
    const item = manualExam({
      review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations: 'never', releaseAt: null },
    });
    const { attempt, storage, service } = await submitted(item, { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Considered.' });
    await service.completeGrading(instructor, attempt.id);
    await storage.updateAttempt(attempt.id, { resultAvailableAt: null });

    const legacy = await service.review(learner, attempt.id);
    expect(legacy.resultsAvailable).toBe(true);
    expect(legacy).not.toHaveProperty('manualFeedback');

    // Released, or completed, publishes the feedback — the score policy never does.
    await service.release(instructor, { attemptId: attempt.id });
    await expect(service.review(learner, attempt.id))
      .resolves.toMatchObject({ manualFeedback: { 's2/e2': 'Considered.' } });
  });
});

describe('manual grading drafts', () => {
  it('re-scores an already scored question and never finalizes', async () => {
    const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });

    const first = await service.manualGrade(instructor, attempt.id, 's2/e2', 1, { en: 'Thin.' });
    expect(first).toMatchObject({ status: 'pending_manual', resultAvailableAt: null });

    // The second save overwrites the first: the per-question guard re-grades the
    // pinned question rather than reading the stored result it just wrote.
    const second = await service.manualGrade(instructor, attempt.id, 's2/e2', 4, { en: 'Complete.' });
    expect(second).toMatchObject({ status: 'pending_manual', resultAvailableAt: null });
    const stored = (await storage.listAnswers(attempt.id)).find(({ questionId }) => questionId === 's2/e2');
    expect(stored).toMatchObject({ manualPoints: 4, manualFeedback: { en: 'Complete.' } });
    // No aggregate was written to the attempt while it stays a draft.
    expect((await storage.getAttempt(attempt.id))?.points).toBe(8);
  });

  it('rejects a score above the pinned question maximum', async () => {
    const { attempt, service } = await submitted(manualExam(), { manual: 's2/e2' });

    await expect(service.manualGrade(instructor, attempt.id, 's2/e2', 5, null))
      .rejects.toThrow(RangeError);
  });

  it('refuses every grade edit once grading is complete', async () => {
    const { attempt, service } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    await service.completeGrading(instructor, attempt.id);

    await expect(service.manualGrade(instructor, attempt.id, 's2/e2', 1, null))
      .rejects.toMatchObject({ code: 'ATTEMPT_NOT_ACTIVE' });
  });

  it('denies a draft save from outside the attempt branch', async () => {
    const { attempt, service } = await submitted(manualExam(), { manual: 's2/e2' });
    const other: ExamActor = { ...instructor, branchId: 'other-branch' };

    await expect(service.manualGrade(other, attempt.id, 's2/e2', 3, null))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('explicit grading completion', () => {
  it('publishes score and feedback without touching the answer key', async () => {
    const { attempt, storage, service, recomputeProgress } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { vi: 'Tốt.', en: 'Good.' });

    const { attempt: completed, transitioned } = await service.completeGrading(instructor, attempt.id);

    expect(transitioned).toBe(true);
    expect(completed).toMatchObject({ status: 'graded', points: 11, maxPoints: 12, percent: 91.67 });
    expect(completed.resultAvailableAt).toEqual(new Date(AT));
    expect(completed.releasedAt).toBeNull();
    expect(storage.getGrade(learner.id, aiExam.id)?.percent).toBe(91.67);
    expect(recomputeProgress).toHaveBeenCalledTimes(2);

    const review = await service.review(learner, attempt.id);
    expect(review).toMatchObject({ released: false, manualFeedback: { 's2/e2': 'Good.' } });
    expect(review.score).toEqual({ points: 11, maxPoints: 12, percent: 91.67 });
    expect(review.revealed.correctAnswers).toBeUndefined();
    expect(review.revealed.explanations).toBeUndefined();
  });

  it('refuses completion while a manual question is unscored and names it', async () => {
    const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });

    await expect(service.completeGrading(instructor, attempt.id)).rejects.toMatchObject({
      code: 'MANUAL_GRADING_INCOMPLETE',
      details: { outstanding: ['s2/e2'] },
    });
    expect((await storage.getAttempt(attempt.id))?.status).toBe('pending_manual');
  });

  it('recalculates a nested question group from its manually scored child', async () => {
    const copy = structuredClone(allTypesExam);
    const auto = { ...structuredClone(copy.grading.questions['s1/x1']), id: 's1/x1/auto', parentId: 's1/x1' };
    const essay = { ...structuredClone(aiExam.grading.questions['s2/e2']), id: 's1/x1/essay', parentId: 's1/x1' };
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
    const item = withExamSettings(copy, { review: { ...SEALED } });

    const h = harness(item);
    const started = await h.service.start(learner, 'course-1', item.id);
    const attempt = (await h.storage.getAttempt(started.attemptId))!;
    await h.service.save(learner, attempt.id, {
      ...answersFor(attempt, false),
      's1/x1': { auto: ['inline', 'ref', 'pool'], essay: 'A concrete risk with a mitigation.' },
    });
    await h.service.submit(learner, attempt.id);

    // Only the group child is scored; completion must aggregate the whole group.
    await h.service.manualGrade(instructor, attempt.id, 's1/x1/essay', 3, { en: 'Specific.' });
    const { attempt: completed } = await h.service.completeGrading(instructor, attempt.id);

    expect(completed).toMatchObject({ status: 'graded', points: 5, maxPoints: 10, percent: 50 });
    expect(completed.resultAvailableAt).toEqual(new Date(AT));
    const parent = (await h.storage.listAnswers(attempt.id)).find(({ questionId }) => questionId === 's1/x1');
    expect(parent?.result).toMatchObject({
      points: 5,
      maxPoints: 6,
      children: [
        { questionId: 's1/x1/auto', points: 2, maxPoints: 2 },
        { questionId: 's1/x1/essay', points: 3, maxPoints: 4 },
      ],
    });
  });

  it('returns the same final state on a retry without moving the timestamp', async () => {
    const { attempt, service, clock, recomputeProgress } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    const first = await service.completeGrading(instructor, attempt.id);

    clock.set('2026-09-03T00:00:00.000Z');
    const retry = await service.completeGrading(instructor, attempt.id);

    expect(retry.transitioned).toBe(false);
    expect(retry.attempt.resultAvailableAt).toEqual(first.attempt.resultAvailableAt);
    expect(retry.attempt).toMatchObject({ status: 'graded', points: 11, percent: 91.67 });
    // The retry must not repeat the grade and progress effects.
    expect(recomputeProgress).toHaveBeenCalledTimes(2);
  });

  it('transitions once and runs completion effects once under concurrent requests', async () => {
    const { attempt, service, recomputeProgress } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);

    const results = await Promise.all([
      service.completeGrading(instructor, attempt.id),
      service.completeGrading(instructor, attempt.id),
    ]);

    expect(results.filter(({ transitioned }) => transitioned)).toHaveLength(1);
    for (const { attempt: settled } of results) {
      expect(settled).toMatchObject({ status: 'graded', points: 11 });
      expect(settled.resultAvailableAt).toEqual(new Date(AT));
    }
    expect(recomputeProgress).toHaveBeenCalledTimes(2);
  });

  it('does not report a legacy completion that wins the lock as a newly available result', async () => {
    const { attempt, service, storage } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    vi.spyOn(storage, 'completeManualGrading').mockImplementation(async (id) => {
      await storage.updateAttempt(id, { status: 'graded', resultAvailableAt: null });
      return { transitioned: false, answersChanged: false, attempt: (await storage.getAttempt(id))! };
    });
    await expect(service.completeGrading(instructor, attempt.id)).rejects.toMatchObject({ code: 'LEGACY_RESULT_UNRELEASED' });
    expect((await storage.getAttempt(attempt.id))?.resultAvailableAt).toBeNull();
  });

  it('aborts and preserves the draft when a grading edit lands during finalization', async () => {
    const storage = new InMemoryExamRepo();
    let armed = false;
    let interference: (() => Promise<void>) | null = null;
    const repo = delegate(storage, {
      listAnswers: async (attemptId: string) => {
        const snapshot = await storage.listAnswers(attemptId);
        if (armed && interference) {
          const run = interference;
          interference = null;
          await run();
        }
        return snapshot;
      },
    });
    const item = manualExam();
    const clock = new MutableClock(new Date(AT));
    const service = createExamService({
      repo,
      clock,
      bank: bankSource,
      loadItem: async () => itemContext(item),
      isEnrolled: async () => true,
    });
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = (await storage.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, {
      ...answersFor(attempt, true),
      's2/e2': 'A responsible study use with a clear limitation.',
    });
    await service.submit(learner, attempt.id);
    await service.manualGrade(instructor, attempt.id, 's2/e2', 1, { en: 'Thin.' });

    // Every read the completion takes is followed by a competing draft save, so
    // its compare-and-set can never match and all three retries are exhausted.
    armed = true;
    let score = 2;
    const rewrite = async () => {
      await service.manualGrade(instructor, attempt.id, 's2/e2', score, { en: `Rescored ${score}.` });
      score += 1;
      interference = rewrite;
    };
    interference = rewrite;

    await expect(service.completeGrading(instructor, attempt.id))
      .rejects.toMatchObject({ code: 'GRADING_CONFLICT' });

    // The grader keeps their latest edit and the attempt is still finishable.
    const stored = (await storage.getAttempt(attempt.id))!;
    expect(stored.status).toBe('pending_manual');
    expect(stored.resultAvailableAt).toBeNull();
    expect((await storage.listAnswers(attempt.id)).find(({ questionId }) => questionId === 's2/e2'))
      .toMatchObject({ manualPoints: 4 });

    armed = false;
    interference = null;
    await expect(service.completeGrading(instructor, attempt.id))
      .resolves.toMatchObject({ transitioned: true, attempt: { status: 'graded', points: 12 } });
  });

  it('reports an already automatic attempt as complete without changing it', async () => {
    const { attempt, storage, service } = await submitted(withExamSettings(allTypesExam, { review: { ...SEALED } }));

    const outcome = await service.completeGrading(instructor, attempt.id);

    expect(outcome.transitioned).toBe(false);
    expect(outcome.attempt.resultAvailableAt).toEqual(new Date(AT));
    expect((await storage.getAttempt(attempt.id))?.releasedAt).toBeNull();
  });

  it('rejects completion for an attempt that is not awaiting manual grading', async () => {
    const item = manualExam();
    const h = harness(item);
    const started = await h.service.start(learner, 'course-1', item.id);

    await expect(h.service.completeGrading(instructor, started.attemptId))
      .rejects.toMatchObject({ code: 'ATTEMPT_NOT_ACTIVE' });
  });

  it('denies completion from outside the attempt branch', async () => {
    const { attempt, service } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    const other: ExamActor = { ...instructor, branchId: 'other-branch' };

    await expect(service.completeGrading(other, attempt.id))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a stored manual score that exceeds its pinned question maximum', async () => {
    const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    // A score written around the draft endpoint, or against a different rubric.
    const stored = (await storage.listAnswers(attempt.id)).find(({ questionId }) => questionId === 's2/e2')!;
    await storage.upsertAnswers([{ ...stored, manualPoints: 99 }]);

    await expect(service.completeGrading(instructor, attempt.id)).rejects.toThrow(RangeError);
    expect((await storage.getAttempt(attempt.id))?.status).toBe('pending_manual');
  });

  it('refuses a draft write that a completion overtakes between its read and its write', async () => {
    // Interleaving A: the draft reads `pending_manual`, a completion commits, then
    // the draft tries to write. The guarded write must refuse rather than land a
    // score on an attempt whose total was already published without it.
    const storage = new InMemoryExamRepo();
    let completeBeforeWrite: (() => Promise<void>) | null = null;
    const repo = delegate(storage, {
      saveManualDraft: async (attemptId, answer) => {
        const run = completeBeforeWrite;
        completeBeforeWrite = null;
        if (run) await run();
        return storage.saveManualDraft(attemptId, answer);
      },
    });
    const item = manualExam();
    const service = createExamService({
      repo,
      clock: new MutableClock(new Date(AT)),
      bank: bankSource,
      loadItem: async () => itemContext(item),
      isEnrolled: async () => true,
    });
    const started = await service.start(learner, 'course-1', item.id);
    const attempt = (await storage.getAttempt(started.attemptId))!;
    await service.save(learner, attempt.id, {
      ...answersFor(attempt, true),
      's2/e2': 'A responsible study use with a clear limitation.',
    });
    await service.submit(learner, attempt.id);
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'Good.' });

    completeBeforeWrite = async () => {
      await service.completeGrading(instructor, attempt.id);
    };
    await expect(service.manualGrade(instructor, attempt.id, 's2/e2', 1, { en: 'Overtaken.' }))
      .rejects.toMatchObject({ code: 'ATTEMPT_NOT_ACTIVE' });

    // The published total still matches the stored score it was computed from.
    const stored = (await storage.getAttempt(attempt.id))!;
    expect(stored).toMatchObject({ status: 'graded', points: 11, percent: 91.67 });
    expect((await storage.listAnswers(attempt.id)).find(({ questionId }) => questionId === 's2/e2'))
      .toMatchObject({ manualPoints: 3, manualFeedback: { en: 'Good.' } });
  });

  it('keeps the stored score and published total consistent under a draft/complete race', async () => {
    // Interleaving B: both operations are launched together, in both orders. Whoever
    // loses is refused, and the attempt's total must always equal the manual score
    // actually stored on the answer row.
    for (const draftFirst of [true, false]) {
      const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });
      await service.manualGrade(instructor, attempt.id, 's2/e2', 3, { en: 'First.' });

      const draft = () => service.manualGrade(instructor, attempt.id, 's2/e2', 1, { en: 'Second.' });
      const complete = () => service.completeGrading(instructor, attempt.id);
      const settled = await Promise.allSettled(draftFirst ? [draft(), complete()] : [complete(), draft()]);

      const stored = (await storage.getAttempt(attempt.id))!;
      const answer = (await storage.listAnswers(attempt.id))
        .find(({ questionId }) => questionId === 's2/e2')!;
      if (stored.status === 'graded') {
        // 8 auto points, plus whichever manual score the answer row actually holds.
        expect(stored.points).toBe(8 + answer.manualPoints!);
        expect(stored.resultAvailableAt).not.toBeNull();
      } else {
        expect(stored.resultAvailableAt).toBeNull();
      }
      expect(settled.some(({ status }) => status === 'fulfilled')).toBe(true);
    }
  });

  it('refuses to complete a historical graded attempt that has no result timestamp', async () => {
    const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    await service.completeGrading(instructor, attempt.id);
    // Reproduce a row graded before the column existed: graded, never released,
    // no availability timestamp.
    await storage.updateAttempt(attempt.id, { resultAvailableAt: null });

    // Succeeding here would break the endpoint's guarantee that a success always
    // carries `resultAvailableAt`, and would backfill a result that must stay
    // hidden until it is handled through the legacy release operation.
    await expect(service.completeGrading(instructor, attempt.id))
      .rejects.toMatchObject({ code: 'LEGACY_RESULT_UNRELEASED' });
    expect((await storage.getAttempt(attempt.id))?.resultAvailableAt).toBeNull();
    expect(await service.review(learner, attempt.id)).not.toHaveProperty('score');

    // The legacy operation still owns it.
    await expect(service.release(instructor, { attemptId: attempt.id }))
      .resolves.toMatchObject({ released: [{ attemptId: attempt.id }] });
  });

  it('keeps release and completion independent in both directions', async () => {
    const { attempt, storage, service } = await submitted(manualExam(), { manual: 's2/e2' });
    await service.manualGrade(instructor, attempt.id, 's2/e2', 3, null);
    await service.completeGrading(instructor, attempt.id);

    // Completion left the attempt releasable, and releasing it does not re-stamp
    // availability.
    const released = await service.release(instructor, { attemptId: attempt.id });
    expect(released.released).toHaveLength(1);
    const stored = (await storage.getAttempt(attempt.id))!;
    expect(stored.resultAvailableAt).toEqual(new Date(AT));
    expect(stored.releasedAt).toEqual(new Date(AT));
  });
});

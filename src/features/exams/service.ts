import { learnerQuestionResult } from '@/content-engine/grading/learner-result';
import type { GradingItem, GradingQuestion, LearnerItem } from '../../content-engine/compile';
import { applyScoringPolicy, gradeAll, gradeQuestion, round2, type QuestionResult } from '../../content-engine/grading';
import { buildRevealed } from '../../content-engine/render/preview-runtime';
import type { RevealedInfo } from '../../content-engine/render/runtime';
import { seededShuffle } from '../../content-engine/render/shuffle';
import {
  LEARNER_FORBIDDEN_KEYS,
  LEARNER_SKIPPED_SUBTREES,
} from '../../content-engine/compile/project';
import { drawPools, type DrawnPoolQuestion } from './pools';
import type {
  BankSource,
  Clock,
  ExamActor,
  ExamAnswerRecord,
  ExamAttemptRecord,
  ExamEventInput,
  ExamEventType,
  ExamRepo,
  LoadExamItem,
} from './types';
import { ExamError } from './types';
import type { AnalyticsEventName, ServerAnalyticsProps } from '../../lib/analytics';

export interface ExamServiceDependencies {
  repo: ExamRepo;
  clock: Clock;
  bank: BankSource;
  loadItem: LoadExamItem;
  isEnrolled: (userId: string, courseVersionId: string) => Promise<boolean>;
  recomputeProgress?: (attempt: ExamAttemptRecord) => Promise<void>;
  onExamPassed?: (attempt: ExamAttemptRecord) => Promise<void>;
  awardXp?: (attempt: ExamAttemptRecord) => Promise<void>;
  track?: (name: AnalyticsEventName, props: ServerAnalyticsProps) => Promise<void>;
}

export interface ExamStartResult {
  attemptId: string;
  attemptNo: number;
  status: ExamAttemptRecord['status'];
  late: boolean;
  startedAt: Date;
  deadlineAt: Date | null;
  sectionDeadlines: Record<string, Date | null>;
  answers: Record<string, unknown>;
  learner: { sections: Record<string, unknown>[] };
}

export interface ExamSubmitResult {
  attemptId: string;
  status: ExamAttemptRecord['status'];
  late: boolean;
  points: number | null;
  maxPoints: number | null;
  percent: number | null;
  passed: boolean | null;
  revealed?: Pick<RevealedInfo, 'correctAnswers' | 'explanations'>;
}

export interface ExamReviewResult {
  attemptId: string;
  status: ExamAttemptRecord['status'];
  late: boolean;
  /**
   * The pinned answer key and explanations may be shown. Deliberately NOT a
   * statement about the score.
   */
  released: boolean;
  /**
   * Whether this response actually carries the score, i.e. exactly whether `score`
   * and `results` are present. True both for a newly completed grading and for a
   * historical attempt whose pinned `showScore` already made its score visible, so
   * a consumer can label availability without re-deriving the policy. It is NOT a
   * statement that grading finished under the new model — that marker stays
   * internal, because it governs manual feedback and nothing the learner should
   * infer. Always populated; typed optional so existing review fixtures stay valid
   * and a consumer may keep reading `score` presence instead.
   */
  resultsAvailable?: boolean;
  answers: Record<string, unknown>;
  results?: QuestionResult[];
  score?: { points: number; maxPoints: number; percent: number };
  manualFeedback?: Record<string, string>;
  revealed: RevealedInfo;
}

export interface ExamSessionResult {
  attemptsUsed: number;
  attempt: ExamStartResult | null;
}

export type SweepResult =
  | { attemptId: string; status: ExamAttemptRecord['status'] }
  | { attemptId: string; error: { code: string; message: string } };

export interface ExamReleaseResult {
  released: { attemptId: string; releasedAt: Date }[];
  skipped: { forbidden: number; unassigned: number; alreadyReleased: string[]; notReleasable: string[] };
}

export interface ExamCompleteGradingOutcome {
  attempt: ExamAttemptRecord;
  /** False when the attempt was already complete: an idempotent retry or lost race. */
  transitioned: boolean;
}

export interface ExamService {
  session(actor: ExamActor, courseId: string, itemId: string): Promise<ExamSessionResult>;
  start(actor: ExamActor, courseId: string, itemId: string): Promise<ExamStartResult>;
  save(actor: ExamActor, attemptId: string, answers: Record<string, unknown>): Promise<ExamAnswerRecord[]>;
  submit(actor: ExamActor, attemptId: string): Promise<ExamSubmitResult>;
  review(actor: ExamActor, attemptId: string): Promise<ExamReviewResult>;
  release(actor: ExamActor, target: { itemId: string; courseVersionId: string } | { attemptId: string }): Promise<ExamReleaseResult>;
  /**
   * Saves ONE manual question's score and feedback as a draft. It never finalizes:
   * the attempt stays `pending_manual`, no aggregate score is written to it and no
   * grade, XP or skill effect runs, so nothing is exposed to the learner. Callable
   * repeatedly, including to overwrite an already scored question.
   */
  manualGrade(actor: ExamActor, attemptId: string, questionId: string, points: number, feedback: unknown): Promise<ExamAttemptRecord>;
  /**
   * Explicitly completes a fully graded manual attempt. Atomic and idempotent, and
   * the only path that stamps `resultAvailableAt` for a manual attempt.
   */
  completeGrading(actor: ExamActor, attemptId: string): Promise<ExamCompleteGradingOutcome>;
  sweepExpired(): Promise<SweepResult[]>;
  events(actor: ExamActor, attemptId: string, events: readonly ExamEventInput[]): Promise<{ accepted: number; dropped: number }>;
}

const GRACE_MS = 30_000;
const EVENT_CAP = 500;
const EVENT_TYPES = new Set<ExamEventType>([
  'focus_lost',
  'focus_gained',
  'visibility_hidden',
  'paste',
  'fullscreen_exit',
]);
const LEARNER_RESPONSE_FORBIDDEN_KEYS = new Set([
  ...LEARNER_FORBIDDEN_KEYS,
  'optionFeedback',
  'rubric',
]);
const LEARNER_RESPONSE_SKIPPED_SUBTREES = new Set<string>(LEARNER_SKIPPED_SUBTREES);

const newId = () => globalThis.crypto.randomUUID();
const allQuestionIds = (attempt: ExamAttemptRecord) => attempt.questionSet.sections.flatMap((section) => section.questionIds);
const isAfterGrace = (attempt: ExamAttemptRecord, now: Date) =>
  attempt.deadlineAt !== null && now.getTime() > attempt.deadlineAt.getTime() + GRACE_MS;

async function runPostCommitEffects(
  effects: Array<{ name: string; run: () => Promise<void> }>,
  attempt: Pick<ExamAttemptRecord, 'id' | 'courseVersionId'>,
) {
  const correlationId = newId();
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (error) {
      // The attempt transition is already durable. A client retry here can
      // duplicate work, so reconciliation owns recovery from downstream outages.
      console.error('Exam post-commit side effect failed', {
        effect: effect.name,
        attemptId: attempt.id,
        courseVersionId: attempt.courseVersionId,
        correlationId,
        error,
      });
    }
  }
}

function sweepError(error: unknown): { code: string; message: string } {
  if (error instanceof ExamError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'SWEEP_FAILED', message: error.message };
  return { code: 'SWEEP_FAILED', message: 'Unknown exam sweep failure' };
}

function isAfterSectionGrace(attempt: ExamAttemptRecord, questionIdToSave: string, now: Date) {
  const section = attempt.questionSet.sections.find(({ questionIds }) => questionIds.includes(questionIdToSave));
  return section?.deadlineOffsetMs !== null
    && section?.deadlineOffsetMs !== undefined
    && now.getTime() > attempt.startedAt.getTime() + section.deadlineOffsetMs + GRACE_MS;
}

function can(actor: ExamActor, permission: NonNullable<ExamActor['permissions']>[number], branchId: string | null) {
  return Boolean(
    actor.permissions?.includes(permission)
    && (
      actor.branchId == null
      || actor.branchId === branchId
      || (actor.global === true && branchId === null)
    ),
  );
}

function hasPermission(actor: ExamActor, permission: NonNullable<ExamActor['permissions']>[number]) {
  return Boolean(actor.permissions?.includes(permission));
}

function requirePermission(actor: ExamActor, permission: NonNullable<ExamActor['permissions']>[number], branchId: string | null) {
  if (!can(actor, permission, branchId)) {
    throw new ExamError('FORBIDDEN', `Missing permission: ${permission}.`);
  }
}

function flattenGrading(question: GradingQuestion): GradingQuestion[] {
  return [question, ...(question.children?.flatMap(flattenGrading) ?? [])];
}

function sanitizeLearnerValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLearnerValue);
  if (typeof value !== 'object' || value === null) return structuredClone(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !LEARNER_RESPONSE_FORBIDDEN_KEYS.has(key))
      .map(([key, entry]) => [
        key,
        LEARNER_RESPONSE_SKIPPED_SUBTREES.has(key)
          ? structuredClone(entry)
          : sanitizeLearnerValue(entry),
      ]),
  );
}

function learnerProjection(learner: LearnerItem): ExamStartResult['learner'] {
  const sanitized = sanitizeLearnerValue(learner) as Record<string, unknown>;
  return {
    sections: Array.isArray(sanitized.sections)
      ? sanitized.sections as Record<string, unknown>[]
      : [],
  };
}

function localeRender<T>(
  renders: Partial<Record<ExamActor['locale'], T>>,
  locale: ExamActor['locale'],
  defaultLocale: ExamActor['locale'],
  details: Record<string, unknown>,
): T {
  const render = renders[locale] ?? renders[defaultLocale];
  if (render === undefined) {
    throw new ExamError(
      'LOCALE_UNAVAILABLE',
      `No exam render is available for locale "${locale}" or default locale "${defaultLocale}".`,
      { locale, defaultLocale, ...details },
    );
  }
  return render;
}

function isPoolPlaceholder(value: unknown): value is { $pool: { id: string } } {
  return typeof value === 'object'
    && value !== null
    && '$pool' in value
    && typeof (value as { $pool?: { id?: unknown } }).$pool?.id === 'string';
}

function questionId(value: unknown): string | null {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null;
}

function shuffleOptions(
  question: unknown,
  seed: string,
  optionOrders: Record<string, string[]>,
): unknown {
  if (typeof question !== 'object' || question === null || Array.isArray(question)) return question;
  const copy = structuredClone(question) as Record<string, unknown>;
  const id = questionId(copy);
  if (id && Array.isArray(copy.options)) {
    const options = seededShuffle(copy.options as unknown[], `${seed}:${id}:options`);
    copy.options = options;
    optionOrders[id] = options
      .map((option) => questionId(option))
      .filter((optionId): optionId is string => optionId !== null);
  }
  if (Array.isArray(copy.questions)) {
    copy.questions = copy.questions.map((child) => shuffleOptions(child, seed, optionOrders));
  }
  return copy;
}

function learnerWithDraws(
  learner: LearnerItem,
  grading: GradingItem,
  drawn: Record<string, DrawnPoolQuestion[]>,
  locale: ExamActor['locale'],
  defaultLocale: ExamActor['locale'],
  seed: string,
): { learner: LearnerItem; grading: GradingItem; questionSet: ExamAttemptRecord['questionSet'] } {
  const learnerSnapshot = structuredClone(learner);
  const gradingSnapshot = structuredClone(grading);
  const learnerSections = Array.isArray(learnerSnapshot.sections)
    ? learnerSnapshot.sections as Record<string, unknown>[]
    : [];
  const settings = gradingSnapshot.exam!;
  const questionSetSections: ExamAttemptRecord['questionSet']['sections'] = [];
  let cumulativeSectionDeadlineMs = 0;
  let sectionScheduleIsContinuous = true;

  for (const gradingSection of settings.sections) {
    const learnerSection = learnerSections.find((section) => section.id === gradingSection.id);
    const sourceQuestions = learnerSection && Array.isArray(learnerSection.questions)
      ? learnerSection.questions
      : [];
    let questions = sourceQuestions.flatMap((question) => {
      if (!isPoolPlaceholder(question)) return [question];
      return (drawn[gradingSection.id] ?? [])
        .filter((entry) => entry.poolId === question.$pool.id)
        .map((entry) => localeRender(
          entry.renders,
          locale,
          defaultLocale,
          { sectionId: gradingSection.id, questionId: entry.sourceId },
        ));
    });
    if (settings.shuffleQuestions) questions = seededShuffle(questions, `${seed}:${gradingSection.id}:questions`);

    const optionOrders: Record<string, string[]> = {};
    if (settings.shuffleOptions) {
      questions = questions.map((question) => shuffleOptions(question, seed, optionOrders));
    }
    const questionIds = questions.map(questionId).filter((id): id is string => id !== null);
    if (learnerSection) learnerSection.questions = questions;
    gradingSection.questionIds = questionIds;
    if (gradingSection.timeLimitMinutes === undefined) sectionScheduleIsContinuous = false;
    const deadlineOffsetMs = gradingSection.timeLimitMinutes === undefined || !sectionScheduleIsContinuous
      ? null
      : cumulativeSectionDeadlineMs + gradingSection.timeLimitMinutes * 60_000;
    if (deadlineOffsetMs !== null) cumulativeSectionDeadlineMs = deadlineOffsetMs;
    questionSetSections.push({ id: gradingSection.id, questionIds, optionOrders, deadlineOffsetMs });
  }

  for (const question of Object.values(drawn).flat()) {
    for (const entry of flattenGrading(question.grading)) gradingSnapshot.questions[entry.id] = entry;
  }
  return {
    learner: learnerSnapshot,
    grading: gradingSnapshot,
    questionSet: {
      sections: questionSetSections,
      learner: learnerSnapshot,
      locale,
      defaultLocale,
    },
  };
}

const revealAllowed = (policy: 'immediately' | 'on_release' | 'never', released: boolean) =>
  policy === 'immediately' || (policy === 'on_release' && released);

function groupStatus(children: QuestionResult[]): QuestionResult['status'] {
  const statuses = new Set(children.map((child) => child.status));
  if (statuses.has('pending_manual')) return 'pending_manual';
  if (children.every((child) => child.status === 'incomplete')) return 'incomplete';
  if (children.every((child) => child.status === 'correct' || child.status === 'self_assessed')) return 'correct';
  return children.some((child) => child.points > 0) ? 'partial' : 'incorrect';
}

function localizedManualFeedback(
  value: unknown,
  locale: ExamActor['locale'],
  defaultLocale: ExamActor['locale'],
): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const map = value as Record<string, unknown>;
  const candidate = map[locale] ?? map[defaultLocale] ?? map.vi ?? map.en;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function applyManualResults(
  result: QuestionResult,
  manualResults: ReadonlyMap<string, QuestionResult>,
): QuestionResult {
  const manual = manualResults.get(result.questionId);
  if (manual) return structuredClone(manual);
  if (!result.children) return result;
  const children = result.children.map((child) => applyManualResults(child, manualResults));
  return {
    ...result,
    status: groupStatus(children),
    points: round2(children.reduce((sum, child) => sum + child.points, 0)),
    maxPoints: children.reduce((sum, child) => sum + child.maxPoints, 0),
    children,
  };
}

/** The stored result for a manually scored question, derived from the pinned rubric. */
function manualResult(pending: QuestionResult, points: number): QuestionResult {
  return {
    ...pending,
    points: round2(points),
    status: points >= pending.maxPoints ? 'correct' : points > 0 ? 'partial' : 'incorrect',
  };
}

/** Every manual question in the pinned snapshot, including question-group children. */
function manualQuestionIds(
  attempt: ExamAttemptRecord,
  answers: readonly ExamAnswerRecord[],
): string[] {
  return allQuestionIds(attempt)
    .flatMap((id) => {
      const question = attempt.gradingSnapshot.questions[id];
      return question ? flattenGrading(question) : [];
    })
    .filter((question) => {
      const located = nestedAnswerValue(question, attempt.gradingSnapshot.questions, answers);
      return located !== null
        && gradeQuestion(question, located.answer).status === 'pending_manual';
    })
    .map((question) => question.id);
}

/** Manual questions with no stored score yet, for the caller to highlight. */
function outstandingManualQuestions(
  attempt: ExamAttemptRecord,
  answers: readonly ExamAnswerRecord[],
): string[] {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  return manualQuestionIds(attempt, answers).filter((id) => {
    const stored = byId.get(id);
    return stored?.manualPoints == null || stored.result === null;
  });
}

/**
 * A stored draft score could have been written against a different pinned rubric, or
 * by a client that bypassed the draft endpoint. Completion re-checks the range so a
 * finalized total can never exceed the question it came from.
 */
function assertManualScoresInRange(
  attempt: ExamAttemptRecord,
  answers: readonly ExamAnswerRecord[],
): void {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (const questionId of manualQuestionIds(attempt, answers)) {
    const stored = byId.get(questionId);
    const question = attempt.gradingSnapshot.questions[questionId];
    if (stored?.manualPoints == null || !question) continue;
    const located = nestedAnswerValue(question, attempt.gradingSnapshot.questions, answers);
    const maxPoints = located ? gradeQuestion(question, located.answer).maxPoints : 0;
    if (!Number.isFinite(stored.manualPoints) || stored.manualPoints < 0 || stored.manualPoints > maxPoints) {
      throw new RangeError(
        `Stored manual points for "${questionId}" must be between 0 and ${maxPoints}.`,
      );
    }
  }
}

function gradeAttempt(
  attempt: ExamAttemptRecord,
  answers: readonly ExamAnswerRecord[],
) {
  const questions = allQuestionIds(attempt)
    .map((id) => attempt.gradingSnapshot.questions[id])
    .filter((question): question is GradingQuestion => question !== undefined);
  const answerValues = Object.fromEntries(answers.map((answer) => [answer.questionId, answer.answer]));
  const base = gradeAll(questions, answerValues);
  const manualResults = new Map(
    answers
      .filter((answer): answer is ExamAnswerRecord & { result: QuestionResult } =>
        answer.manualPoints !== null && answer.result !== null)
      .map((answer) => [answer.questionId, answer.result]),
  );
  const results = base.results.map((result) => applyManualResults(result, manualResults));
  const points = round2(results.reduce((sum, result) => sum + result.points, 0));
  const maxPoints = results.reduce((sum, result) => sum + result.maxPoints, 0);
  return {
    results,
    points,
    maxPoints,
    percent: maxPoints ? round2((points / maxPoints) * 100) : 0,
    pendingManual: results.some((result) => result.status === 'pending_manual'),
  };
}

function toStartResult(
  attempt: ExamAttemptRecord,
  savedAnswers: readonly ExamAnswerRecord[],
): ExamStartResult {
  return {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    late: attempt.late,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    sectionDeadlines: Object.fromEntries(attempt.questionSet.sections.map((section) => [
      section.id,
      section.deadlineOffsetMs === null
        ? null
        : new Date(attempt.startedAt.getTime() + section.deadlineOffsetMs),
    ])),
    answers: Object.fromEntries(savedAnswers.map((answer) => [answer.questionId, answer.answer])),
    learner: learnerProjection(attempt.questionSet.learner),
  };
}

function toSubmitResult(attempt: ExamAttemptRecord): ExamSubmitResult {
  const exam = attempt.gradingSnapshot.exam!;
  // Completed grading publishes the score on its own authority, so a legacy
  // `showScore` withholding setting cannot hide a result the learner now owns.
  // The legacy `immediately` branch additionally requires a fully graded attempt:
  // an attempt still awaiting manual work must not leak its partial auto score.
  const showScore = attempt.resultAvailableAt !== null
    || (attempt.status === 'graded' && exam.review.showScore === 'immediately');
  const reveal = buildRevealed(
    attempt.gradingSnapshot,
    allQuestionIds(attempt),
    attempt.questionSet.locale,
    attempt.questionSet.defaultLocale,
    {
      answers: exam.review.showCorrectAnswers === 'immediately',
      explanations: exam.review.showExplanations === 'immediately',
    },
  );
  const revealed = {
    ...(reveal.correctAnswers ? { correctAnswers: reveal.correctAnswers } : {}),
    ...(reveal.explanations ? { explanations: reveal.explanations } : {}),
  };
  return {
    attemptId: attempt.id,
    status: attempt.status,
    late: attempt.late,
    points: showScore ? attempt.points : null,
    maxPoints: showScore ? attempt.maxPoints : null,
    percent: showScore ? attempt.percent : null,
    passed: showScore && attempt.status === 'graded' && attempt.percent !== null
      ? attempt.percent >= exam.passPercent
      : null,
    ...(Object.keys(revealed).length ? { revealed } : {}),
  };
}

function nestedAnswerValue(
  question: GradingQuestion,
  gradingQuestions: GradingItem['questions'],
  answers: readonly ExamAnswerRecord[],
): { answer: unknown; topLevelAnswer: ExamAnswerRecord } | null {
  const lineage = [question];
  let cursor = question;
  while (cursor.parentId) {
    const parent = gradingQuestions[cursor.parentId];
    if (!parent) return null;
    lineage.unshift(parent);
    cursor = parent;
  }
  const topLevelAnswer = answers.find((entry) => entry.questionId === lineage[0].id);
  if (!topLevelAnswer) return null;
  let value = topLevelAnswer.answer;
  for (let index = 1; index < lineage.length; index += 1) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const parent = lineage[index - 1];
    const child = lineage[index];
    const values = value as Record<string, unknown>;
    value = values[child.id] ?? values[child.id.slice(parent.id.length + 1)];
  }
  return { answer: value, topLevelAnswer };
}

export function createExamService(dependencies: ExamServiceDependencies): ExamService {
  const {
    repo,
    clock,
    bank,
    loadItem,
    isEnrolled,
    recomputeProgress = async () => undefined,
    onExamPassed = async () => undefined,
    awardXp = async () => undefined,
  } = dependencies;
  const trackEvent = dependencies.track ?? (async (name: AnalyticsEventName, props: ServerAnalyticsProps) => {
    const analytics = await import('../../lib/analytics');
    await analytics.track(name, props);
  });

  function emit(name: AnalyticsEventName, props: ServerAnalyticsProps) {
    void Promise.resolve()
      .then(() => trackEvent(name, props))
      .catch((error: unknown) => console.error('Analytics tracking failed', error));
  }

  async function attemptFor(
    actor: ExamActor,
    attemptId: string,
    access: { permission?: 'submission.grade'; system?: true } = {},
  ) {
    const attempt = await repo.getAttempt(attemptId);
    if (!attempt) {
      throw new ExamError('FORBIDDEN', 'The attempt is not available to this actor.');
    }
    if (attempt.userId === actor.id) {
      if (!access.system && !(await isEnrolled(actor.id, attempt.courseVersionId))) {
        throw new ExamError('FORBIDDEN', 'The attempt is not available to this actor.');
      }
      return attempt;
    }
    if (!(access.permission && can(actor, access.permission, attempt.branchId))) {
      throw new ExamError('FORBIDDEN', 'The attempt is not available to this actor.');
    }
    return attempt;
  }

  async function startResult(attempt: ExamAttemptRecord) {
    return toStartResult(attempt, await repo.listAnswers(attempt.id));
  }

  async function recomputeGrade(attempt: ExamAttemptRecord) {
    const exam = attempt.gradingSnapshot.exam!;
    const attempts = await repo.listAttempts(attempt.userId, attempt.itemId, attempt.courseVersionId);
    const percents = attempts
      .sort((left, right) => left.attemptNo - right.attemptNo)
      .filter((candidate) => candidate.percent !== null && candidate.status === 'graded')
      .map((candidate) => candidate.percent!);
    if (!percents.length) return null;
    const percent = applyScoringPolicy(exam.scoringPolicy, percents);
    const grade = await repo.upsertGrade({
      userId: attempt.userId,
      courseVersionId: attempt.courseVersionId,
      itemId: attempt.itemId,
      percent,
      passed: percent >= exam.passPercent,
      policy: exam.scoringPolicy,
      computedAt: clock.now(),
    });
    if (grade.passed && attempt.status === 'graded') {
      await runPostCommitEffects([
        { name: 'skills.exam-passed', run: () => onExamPassed(attempt) },
        { name: 'xp.exam_passed', run: () => awardXp(attempt) },
      ], attempt);
    }
    return grade;
  }

  async function start(actor: ExamActor, courseId: string, itemId: string): Promise<ExamStartResult> {
    const context = await loadItem(actor, courseId, itemId);
    if (!context || !context.enrolled || context.item.kind !== 'exam' || !context.item.grading.exam) {
      throw new ExamError('FORBIDDEN', 'The exam is not available to this learner.');
    }
    const now = clock.now();
    const exam = context.item.grading.exam;
    const timedSectionCount = exam.sections.filter((section) => section.timeLimitMinutes !== undefined).length;
    if (timedSectionCount > 0
      && timedSectionCount < exam.sections.length) {
      throw new ExamError(
        'INVALID_EXAM_CONFIGURATION',
        'Either every section must be timed or every section must be untimed.',
      );
    }
    if ((exam.openAt && now.getTime() < Date.parse(exam.openAt))
      || (exam.closeAt && now.getTime() >= Date.parse(exam.closeAt))) {
      throw new ExamError('EXAM_CLOSED', 'The exam is outside its availability window.');
    }

    const attempts = await repo.listAttempts(actor.id, itemId, context.courseVersionId);
    const active = attempts.find((attempt) => attempt.status === 'in_progress');
    if (active) {
      if (isAfterGrace(active, now)) {
        try {
          await submit(actor, active.id);
        } catch (error) {
          if (!(error instanceof ExamError) || error.code !== 'DEADLINE_PASSED') throw error;
        }
        const settled = await repo.getAttempt(active.id);
        if (!settled) throw new ExamError('FORBIDDEN', 'The attempt is not available to this actor.');
        return startResult(settled);
      }
      return startResult(active);
    }
    if (attempts.length >= exam.attemptsAllowed) {
      throw new ExamError('NO_ATTEMPTS', 'No exam attempts remain.');
    }

    const id = newId();
    const drawn = await drawPools(exam.sections, bank, id, exam.sections.flatMap((section) => section.questionIds));
    const selectedLocale = context.item.renders[actor.locale] ? actor.locale : context.defaultLocale;
    const learnerRender = localeRender(
      context.item.renders,
      actor.locale,
      context.defaultLocale,
      { itemId },
    );
    const assembled = learnerWithDraws(
      learnerRender,
      context.item.grading,
      drawn,
      selectedLocale,
      context.defaultLocale,
      id,
    );
    const sectionLimitMinutes = exam.sections.length > 0
      && exam.sections.every((section) => section.timeLimitMinutes !== undefined)
      ? exam.sections.reduce((sum, section) => sum + section.timeLimitMinutes!, 0)
      : undefined;
    const effectiveLimitMinutes = [exam.timeLimitMinutes, sectionLimitMinutes]
      .filter((value): value is number => value !== undefined)
      .reduce<number | undefined>((minimum, value) => minimum === undefined ? value : Math.min(minimum, value), undefined);
    const attempt: ExamAttemptRecord = {
      id,
      userId: actor.id,
      courseVersionId: context.courseVersionId,
      itemId,
      branchId: context.branchId ?? null,
      attemptNo: attempts.length + 1,
      status: 'in_progress',
      late: false,
      questionSet: assembled.questionSet,
      gradingSnapshot: assembled.grading,
      startedAt: now,
      deadlineAt: effectiveLimitMinutes === undefined
        ? null
        : new Date(now.getTime() + effectiveLimitMinutes * 60_000),
      submittedAt: null,
      points: null,
      maxPoints: null,
      percent: null,
      releasedAt: null,
      resultAvailableAt: null,
    };
    const inserted = await repo.insertAttempt(attempt, exam.attemptsAllowed);
    emit('exam.started', {
      userId: actor.id,
      courseId,
      courseVersionId: inserted.courseVersionId,
      itemId: inserted.itemId,
      attemptId: inserted.id,
      attemptNo: inserted.attemptNo,
      branchId: inserted.branchId,
    });
    return startResult(inserted);
  }

  async function session(actor: ExamActor, courseId: string, itemId: string): Promise<ExamSessionResult> {
    const context = await loadItem(actor, courseId, itemId);
    if (!context || !context.enrolled || context.item.kind !== 'exam' || !context.item.grading.exam) {
      throw new ExamError('FORBIDDEN', 'The exam is not available to this learner.');
    }
    const attempts = await repo.listAttempts(actor.id, itemId, context.courseVersionId);
    const active = attempts.find((attempt) => attempt.status === 'in_progress');
    let selected = active ?? attempts.at(-1) ?? null;
    if (active && isAfterGrace(active, clock.now())) {
      try {
        await submitAttempt(actor, active.id);
      } catch (error) {
        if (!(error instanceof ExamError) || error.code !== 'DEADLINE_PASSED') throw error;
      }
      selected = await repo.getAttempt(active.id);
    }
    return {
      attemptsUsed: attempts.length,
      attempt: selected ? await startResult(selected) : null,
    };
  }

  async function save(actor: ExamActor, attemptId: string, answers: Record<string, unknown>) {
    const attempt = await attemptFor(actor, attemptId);
    if (attempt.status !== 'in_progress') {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'Only an in-progress attempt can be saved.');
    }
    const now = clock.now();
    if (isAfterGrace(attempt, now)) {
      throw new ExamError('DEADLINE_PASSED', 'The exam deadline and grace period have passed.');
    }
    const validIds = new Set(allQuestionIds(attempt));
    if (Object.keys(answers).some((id) => !validIds.has(id))) {
      throw new ExamError('FORBIDDEN', 'An answer referenced a question outside this attempt.');
    }
    if (Object.keys(answers).some((id) => isAfterSectionGrace(attempt, id, now))) {
      throw new ExamError('SECTION_DEADLINE_PASSED', 'The question section deadline and grace period have passed.');
    }
    const existing = new Map((await repo.listAnswers(attemptId)).map((answer) => [answer.questionId, answer]));
    const records = Object.entries(answers).map(([id, answer]): ExamAnswerRecord => ({
      attemptId,
      questionId: id,
      answer: structuredClone(answer),
      result: existing.get(id)?.result ?? null,
      manualPoints: existing.get(id)?.manualPoints ?? null,
      manualFeedback: existing.get(id)?.manualFeedback ?? null,
      gradedBy: existing.get(id)?.gradedBy ?? null,
      updatedAt: now,
    }));
    if (!(await repo.saveActiveAnswers(attemptId, actor.id, records))) {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'Only an in-progress attempt can be saved.');
    }
    // Submission can finish before this response read. Saving authorizes an answer
    // acknowledgement, while grading details remain behind the review policy.
    return (await repo.listAnswers(attemptId)).map((saved) => ({
      attemptId: saved.attemptId,
      questionId: saved.questionId,
      answer: saved.answer,
      updatedAt: saved.updatedAt,
      result: null,
      manualPoints: null,
      manualFeedback: null,
      gradedBy: null,
    }));
  }

  async function submitAttempt(
    actor: ExamActor,
    attemptId: string,
    access: { system?: true } = {},
  ): Promise<ExamSubmitResult> {
    const attempt = await attemptFor(actor, attemptId, access);
    if (attempt.status === 'graded' || attempt.status === 'pending_manual') {
      return toSubmitResult(attempt);
    }
    if (attempt.status === 'expired') {
      throw new ExamError('DEADLINE_PASSED', 'Late submissions are rejected for this exam.');
    }
    if (attempt.status !== 'in_progress') {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'Only an in-progress attempt can be submitted.');
    }
    const now = clock.now();
    const late = isAfterGrace(attempt, now);
    const rejectLate = late && attempt.gradingSnapshot.exam!.lateSubmission === 'reject';
    let finalization: Awaited<ReturnType<ExamRepo['finalizeAttempt']>> | null = null;
    let finalGrade: ReturnType<typeof gradeAttempt> | null = null;
    for (let retry = 0; retry < 3; retry += 1) {
      const storedAnswers = await repo.listAnswers(attemptId);
      const graded = gradeAttempt(attempt, storedAnswers);
      const byId = new Map(storedAnswers.map((answer) => [answer.questionId, answer]));
      const resultRecords = graded.results.map((result): ExamAnswerRecord => ({
        attemptId,
        questionId: result.questionId,
        answer: byId.get(result.questionId)?.answer ?? null,
        result,
        manualPoints: byId.get(result.questionId)?.manualPoints ?? null,
        manualFeedback: byId.get(result.questionId)?.manualFeedback ?? null,
        gradedBy: byId.get(result.questionId)?.gradedBy ?? null,
        updatedAt: now,
      }));
      const finalized = await repo.finalizeAttempt(attemptId, {
        status: rejectLate ? 'expired' : graded.pendingManual ? 'pending_manual' : 'graded',
        branchId: attempt.branchId,
        late,
        submittedAt: now,
        points: rejectLate ? 0 : graded.points,
        maxPoints: graded.maxPoints,
        percent: rejectLate ? 0 : graded.percent,
        // A purely automatic submission finishes grading here, so results become
        // available in the same atomic transition. An attempt that still needs
        // manual work, and a rejected late attempt, publish nothing.
        resultAvailableAt: rejectLate || graded.pendingManual ? null : now,
      }, storedAnswers, resultRecords);
      if (finalized.answersChanged) continue;
      finalization = finalized;
      finalGrade = graded;
      break;
    }
    if (!finalization || !finalGrade) {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'Answers changed during submission; try again.');
    }

    if (rejectLate) {
      const finalized = finalization;
      if (finalized.transitioned) {
        const expired = finalized.attempt;
        await recomputeGrade(expired);
        await runPostCommitEffects([
          { name: 'progress.recompute', run: () => recomputeProgress(expired) },
        ], expired);
        emit('exam.submitted', {
          userId: actor.id,
          courseVersionId: expired.courseVersionId,
          itemId: expired.itemId,
          attemptId: expired.id,
          branchId: expired.branchId,
          status: expired.status,
          percent: expired.percent,
          late: true,
        });
      }
      throw new ExamError('DEADLINE_PASSED', 'Late submissions are rejected for this exam.');
    }

    const finalized = finalization;
    const graded = finalGrade;
    const updated = finalized.attempt;
    if (!finalized.transitioned) {
      if (updated.status === 'expired') {
        throw new ExamError('DEADLINE_PASSED', 'Late submissions are rejected for this exam.');
      }
      return toSubmitResult(updated);
    }
    if (!graded.pendingManual) await recomputeGrade(updated);
    await runPostCommitEffects([
      { name: 'progress.recompute', run: () => recomputeProgress(updated) },
    ], updated);
    emit('exam.submitted', {
      userId: actor.id,
      courseVersionId: updated.courseVersionId,
      itemId: updated.itemId,
      attemptId: updated.id,
      branchId: updated.branchId,
      status: updated.status,
      percent: updated.percent,
      late: updated.late,
    });
    return toSubmitResult(updated);
  }

  async function submit(actor: ExamActor, attemptId: string): Promise<ExamSubmitResult> {
    return submitAttempt(actor, attemptId);
  }

  async function review(actor: ExamActor, attemptId: string): Promise<ExamReviewResult> {
    const attempt = await attemptFor(actor, attemptId, { permission: 'submission.grade' });
    if (attempt.status === 'in_progress' || attempt.status === 'submitted') {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'The attempt is not ready for review.');
    }
    const now = clock.now();
    const policy = attempt.gradingSnapshot.exam!.review;
    const released = attempt.status === 'graded' && (
      attempt.releasedAt !== null
      || (policy.releaseAt !== null && now.getTime() >= Date.parse(policy.releaseAt))
    );
    const storedAnswers = await repo.listAnswers(attemptId);
    const ids = allQuestionIds(attempt);
    const answerMap = new Map(storedAnswers.map((answer) => [answer.questionId, answer]));
    const answers = Object.fromEntries(storedAnswers.map((answer) => [answer.questionId, answer.answer]));
    const results = ids
      .map((id) => answerMap.get(id)?.result)
      .filter((result): result is QuestionResult => result !== null && result !== undefined);
    const manualFeedback = Object.fromEntries(storedAnswers.flatMap((answer) => {
      const feedback = localizedManualFeedback(
        answer.manualFeedback,
        actor.locale,
        attempt.questionSet.defaultLocale,
      );
      return feedback ? [[answer.questionId, feedback]] : [];
    }));
    // Internal marker: grading completed under the result-availability model. It
    // gates manual feedback and feeds the score gate, but it is not what the DTO
    // reports, because a historical attempt can have a visible score with no
    // timestamp and reporting `false` for it would contradict what is on screen.
    const gradingCompleted = attempt.resultAvailableAt !== null;
    // The projected score gate: completed grading, or the legacy pinned policy.
    const legacyScoreVisible = attempt.status === 'graded' && revealAllowed(policy.showScore, released);
    const showScore = gradingCompleted || legacyScoreVisible;
    // Immediate result availability authorizes the aggregate and written feedback,
    // not a new correctness oracle for each automatic question. Preserve the
    // existing breakdown policy and independently configured answer review.
    const showBreakdown = legacyScoreVisible
      || (gradingCompleted && revealAllowed(policy.showCorrectAnswers, released));
    return {
      attemptId,
      status: attempt.status,
      late: attempt.late,
      released,
      // Aggregate score availability; question-level review has its own gate.
      resultsAvailable: showScore,
      answers,
      ...(showBreakdown ? { results: results.map((result) => learnerQuestionResult(result, revealAllowed(policy.showCorrectAnswers, released))) } : {}),
      ...(showScore && attempt.points !== null && attempt.maxPoints !== null && attempt.percent !== null
        ? { score: { points: attempt.points, maxPoints: attempt.maxPoints, percent: attempt.percent } }
        : {}),
      // Manual feedback follows completed grading or an answer-key release, never
      // the legacy score policy: a pinned `showScore` says nothing about whether a
      // grader's written comments were finished.
      ...((gradingCompleted || released) && Object.keys(manualFeedback).length > 0
        ? { manualFeedback }
        : {}),
      revealed: buildRevealed(
        attempt.gradingSnapshot,
        ids,
        actor.locale,
        attempt.questionSet.defaultLocale,
        {
          answers: revealAllowed(policy.showCorrectAnswers, released),
          explanations: revealAllowed(policy.showExplanations, released),
        },
      ),
    };
  }

  async function release(
    actor: ExamActor,
    target: { itemId: string; courseVersionId: string } | { attemptId: string },
  ): Promise<ExamReleaseResult> {
    if (!hasPermission(actor, 'exam.release')) {
      throw new ExamError('FORBIDDEN', 'Missing permission: exam.release.');
    }
    let attempts: ExamAttemptRecord[];
    if ('attemptId' in target) {
      const attempt = await repo.getAttempt(target.attemptId);
      attempts = attempt ? [attempt] : [];
    } else {
      attempts = await repo.listAttempts(null, target.itemId, target.courseVersionId);
    }
    if (!attempts.length) throw new ExamError('FORBIDDEN', 'No releasable exam attempts were found.');
    const at = clock.now();
    const result: ExamReleaseResult = {
      released: [],
      skipped: { forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [] },
    };
    for (const attempt of attempts) {
      if (!can(actor, 'exam.release', attempt.branchId)) {
        if (attempt.branchId === null && actor.branchId != null && actor.global !== true) {
          result.skipped.unassigned += 1;
        } else {
          result.skipped.forbidden += 1;
        }
        continue;
      }
      if (attempt.status !== 'graded') {
        result.skipped.notReleasable.push(attempt.id);
        continue;
      }
      if (attempt.releasedAt !== null) {
        result.skipped.alreadyReleased.push(attempt.id);
        continue;
      }
      const transition = await repo.releaseAttempt(attempt.id, at);
      if (!transition.transitioned) {
        if (transition.attempt.releasedAt !== null) result.skipped.alreadyReleased.push(attempt.id);
        else result.skipped.notReleasable.push(attempt.id);
        continue;
      }
      const released = transition.attempt;
      result.released.push({ attemptId: released.id, releasedAt: released.releasedAt! });
      await runPostCommitEffects([
        { name: 'progress.recompute', run: () => recomputeProgress(released) },
      ], released);
    }
    return result;
  }

  /**
   * Locates one manual question, validates the score against the pinned rubric and
   * stores it as a DRAFT. It deliberately does not aggregate into the attempt: the
   * attempt keeps `status = 'pending_manual'`, its `points`/`percent` stay as the
   * auto-graded submit left them, and `resultAvailableAt` stays null. Nothing here
   * reaches the learner, so a half-finished workbench exposes no partial score. The
   * per-question guard re-grades the pinned question rather than reading the stored
   * result, which is what allows an already scored question to be re-scored.
   */
  async function manualGrade(
    actor: ExamActor,
    attemptId: string,
    questionIdToGrade: string,
    points: number,
    feedback: unknown,
  ): Promise<ExamAttemptRecord> {
    const attempt = await repo.getAttempt(attemptId);
    if (!attempt) throw new ExamError('FORBIDDEN', 'The attempt is not available.');
    requirePermission(actor, 'submission.grade', attempt.branchId);
    if (attempt.status !== 'pending_manual') {
      throw new ExamError(
        'ATTEMPT_NOT_ACTIVE',
        attempt.status === 'graded'
          ? 'Grading is complete for this attempt; scores can no longer be edited.'
          : 'The attempt has no pending manual grade.',
      );
    }
    const gradingQuestion = attempt.gradingSnapshot.questions[questionIdToGrade];
    const storedAnswers = await repo.listAnswers(attemptId);
    const located = gradingQuestion
      ? nestedAnswerValue(gradingQuestion, attempt.gradingSnapshot.questions, storedAnswers)
      : null;
    if (!gradingQuestion || !located) {
      throw new ExamError('FORBIDDEN', 'The manual question is not part of this attempt.');
    }
    const pending = gradeQuestion(gradingQuestion, located.answer);
    if (pending.status !== 'pending_manual') {
      throw new ExamError('FORBIDDEN', 'Only manual questions can receive a manual grade.');
    }
    if (!Number.isFinite(points) || points < 0 || points > pending.maxPoints) {
      throw new RangeError(`Manual points must be between 0 and ${pending.maxPoints}.`);
    }
    const existing = storedAnswers.find((answer) => answer.questionId === questionIdToGrade);
    // The status read above is advisory only. This write re-checks it under the
    // attempt-row lock that completion also takes, so a completion committing in
    // between refuses the draft instead of leaving a stored score that disagrees
    // with the published total.
    const accepted = await repo.saveManualDraft(attemptId, {
      ...(existing ?? {
        attemptId,
        questionId: questionIdToGrade,
        answer: structuredClone(located.answer),
      }),
      result: manualResult(pending, points),
      manualPoints: round2(points),
      manualFeedback: structuredClone(feedback),
      gradedBy: actor.id,
      updatedAt: clock.now(),
    });
    if (!accepted) {
      throw new ExamError(
        'ATTEMPT_NOT_ACTIVE',
        'Grading completed for this attempt while the score was being saved; scores can no longer be edited.',
      );
    }
    return (await repo.getAttempt(attemptId))!;
  }

  /**
   * Finalizes a manually graded attempt in one atomic, idempotent step.
   *
   * Ordering matters: the answers are read, regraded and then written under a
   * compare-and-set on the same snapshot, so a grading draft saved concurrently
   * aborts the completion instead of publishing a total that no longer matches the
   * stored scores. Losing that race is retried; an exhausted retry is reported as a
   * conflict so the caller can keep the grader's edits. Only this path stamps
   * `resultAvailableAt` for a manual attempt, and it never touches `releasedAt`.
   */
  async function completeGrading(
    actor: ExamActor,
    attemptId: string,
  ): Promise<ExamCompleteGradingOutcome> {
    const attempt = await repo.getAttempt(attemptId);
    if (!attempt) throw new ExamError('FORBIDDEN', 'The attempt is not available.');
    requirePermission(actor, 'submission.grade', attempt.branchId);
    if (attempt.status === 'graded') {
      // A row written before result availability existed is fully graded but carries
      // no availability timestamp. Answering 200 here would either break this
      // endpoint's guarantee that a success always carries `resultAvailableAt`, or
      // silently backfill a historical result the decision log says must stay hidden
      // until it is handled deliberately. Refuse and name the operation that owns it.
      if (attempt.resultAvailableAt === null) {
        throw new ExamError(
          'LEGACY_RESULT_UNRELEASED',
          'This attempt was graded before result availability was recorded. Publish it with the exam release operation instead of completing grading.',
        );
      }
      // Already complete: a retry, or a concurrent grader who won. Report the durable
      // final state rather than an error so the caller can lock its UI either way.
      return { attempt, transitioned: false };
    }
    if (attempt.status !== 'pending_manual') {
      throw new ExamError(
        'ATTEMPT_NOT_ACTIVE',
        'Only a submitted attempt awaiting manual grading can be completed.',
      );
    }

    for (let retry = 0; retry < 3; retry += 1) {
      const storedAnswers = await repo.listAnswers(attemptId);
      const regraded = gradeAttempt(attempt, storedAnswers);
      // Nested question groups are recalculated by `gradeAttempt`, so an unscored
      // manual leaf keeps its whole group pending and is caught here.
      if (regraded.pendingManual) {
        throw new ExamError(
          'MANUAL_GRADING_INCOMPLETE',
          'Every manual question needs a valid score before grading is completed.',
          { outstanding: outstandingManualQuestions(attempt, storedAnswers) },
        );
      }
      assertManualScoresInRange(attempt, storedAnswers);
      const answerById = new Map(storedAnswers.map((answer) => [answer.questionId, answer]));
      const updatedAt = clock.now();
      const resultRecords = regraded.results.map((gradedResult) => {
        const answer = answerById.get(gradedResult.questionId);
        if (!answer) {
          throw new ExamError('FORBIDDEN', 'A graded question has no stored answer record.');
        }
        return { ...answer, result: gradedResult, updatedAt };
      });
      const completion = await repo.completeManualGrading(attemptId, {
        points: regraded.points,
        maxPoints: regraded.maxPoints,
        percent: regraded.percent,
        resultAvailableAt: updatedAt,
      }, storedAnswers, resultRecords);
      if (completion.answersChanged) continue;
      if (!completion.transitioned) {
        if (completion.attempt.status !== 'graded') {
          throw new ExamError('ATTEMPT_NOT_ACTIVE', 'The attempt changed while grading was being completed.');
        }
        if (completion.attempt.resultAvailableAt === null) {
          throw new ExamError('LEGACY_RESULT_UNRELEASED', 'This result uses the legacy release operation.');
        }
        return { attempt: completion.attempt, transitioned: false };
      }
      const completed = completion.attempt;
      await recomputeGrade(completed);
      await runPostCommitEffects([
        { name: 'progress.recompute', run: () => recomputeProgress(completed) },
      ], completed);
      return { attempt: completed, transitioned: true };
    }
    throw new ExamError(
      'GRADING_CONFLICT',
      'A grading draft changed while grading was being completed; refresh and retry.',
    );
  }

  async function sweepExpired(): Promise<SweepResult[]> {
    const now = clock.now();
    const expired = await repo.listExpiredInProgress(now);
    const results: SweepResult[] = [];
    for (const attempt of expired) {
      try {
        const submitted = await submitAttempt(
          { id: attempt.userId, locale: attempt.questionSet.locale },
          attempt.id,
          { system: true },
        );
        results.push({ attemptId: attempt.id, status: submitted.status });
      } catch (error) {
        if (error instanceof ExamError && error.code === 'DEADLINE_PASSED') {
          const updated = await repo.getAttempt(attempt.id);
          if (updated) {
            results.push({ attemptId: attempt.id, status: updated.status });
            continue;
          }
        }
        results.push({ attemptId: attempt.id, error: sweepError(error) });
      }
    }
    return results;
  }

  async function events(actor: ExamActor, attemptId: string, incoming: readonly ExamEventInput[]) {
    const attempt = await attemptFor(actor, attemptId);
    if (attempt.status !== 'in_progress') {
      throw new ExamError('ATTEMPT_NOT_ACTIVE', 'Integrity events are accepted only for active attempts.');
    }
    if (incoming.some((event) => !EVENT_TYPES.has(event.type))) {
      throw new RangeError('Unknown exam integrity event type.');
    }
    const now = clock.now();
    const normalized = incoming.map((event) => {
      const requestedAt = event.at ? new Date(event.at) : now;
      if (!Number.isFinite(requestedAt.getTime())) {
        throw new RangeError('Exam integrity event timestamps must be valid dates.');
      }
      return {
        ...event,
        at: new Date(Math.min(
          now.getTime(),
          Math.max(attempt.startedAt.getTime(), requestedAt.getTime()),
        )),
      };
    });
    const accepted = await repo.insertEvents(normalized.map((event) => ({
      id: newId(),
      attemptId,
      type: event.type,
      at: new Date(event.at),
      meta: structuredClone(event.meta ?? {}),
    })), EVENT_CAP);
    return { accepted, dropped: incoming.length - accepted };
  }

  return {
    session,
    start,
    save,
    submit,
    review,
    release,
    manualGrade,
    completeGrading,
    sweepExpired,
    events,
  };
}

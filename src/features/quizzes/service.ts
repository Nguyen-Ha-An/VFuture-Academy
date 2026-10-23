import { learnerQuestionResult } from '@/content-engine/grading/learner-result';
import { gradeAll, gradeQuestion, type GradingItem, type Locale, type QuestionResult, type QuizGradingSettings } from '@/content-engine';
import { findOversizedRegexAnswers, type OversizedAnswer } from '@/content-engine/grading/answer-limits';
import { buildRevealed } from '@/content-engine/render/preview-runtime';
import type { QuizSubmitResult, RevealedInfo } from '@/content-engine/render/runtime';
import { ApiError } from '@/lib/api';
import { assertEnrollmentMembershipAccess,type MembershipAccessDatabase } from '@/features/learning/membership-access';

export interface QuizActor {
  id: string;
  locale: Locale;
}

export interface ProgressHooks {
  recompute(actor: QuizActor, courseId: string): Promise<void>;
  awardXp?(effect: {
    userId: string;
    kind: 'quiz_submitted';
    refType: 'quiz_attempt';
    refId: string;
    points: number;
  }): Promise<void>;
}

interface QuizQueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}

export interface QuizQuery extends PromiseLike<QuizQueryResult> {
  select(columns: string, options?: unknown): QuizQuery;
  eq(column: string, value: unknown): QuizQuery;
  in(column: string, values: readonly unknown[]): QuizQuery;
  insert(value: Record<string, unknown>): QuizQuery;
  maybeSingle(): Promise<QuizQueryResult>;
  single(): Promise<QuizQueryResult>;
}

export interface QuizDatabase {
  from(table: string): QuizQuery;
}

export interface QuizService {
  check(
    actor: QuizActor,
    courseId: string,
    itemId: string,
    quizId: string,
    questionId: string,
    answer: unknown,
  ): Promise<QuestionResult & { revealed: RevealedInfo }>;
  submit(
    actor: QuizActor,
    courseId: string,
    itemId: string,
    quizId: string,
    answers: Record<string, unknown>,
  ): Promise<QuizSubmitResult>;
}

type QuizDefinition = QuizGradingSettings & { questionIds: string[] };

interface QuizContext {
  courseVersionId: string;
  grading: GradingItem;
  quiz: QuizDefinition;
}

function databaseError(message: string): ApiError {
  return new ApiError(500, 'DATABASE_ERROR', message);
}

/**
 * An answer the bounded matcher refuses for its length is not a wrong answer and not a
 * quiz that needs a human: the content is fine and the learner can shorten what they
 * wrote. It is reported per question, before anything is persisted, so every answer
 * stays editable and no attempt or XP is consumed.
 */
function answerTooLong(locale: Locale, oversized: readonly OversizedAnswer[]): ApiError {
  const limit = oversized[0].limit;
  const detail = ({ length }: OversizedAnswer) => ({
    vi: `Câu trả lời dài ${length} ký tự; giới hạn là ${limit}.`,
    en: `The answer is ${length} characters; the limit is ${limit}.`,
  });
  const summary = locale === 'vi'
    ? `${oversized.length} câu trả lời vượt quá giới hạn ${limit} ký tự của câu trả lời ngắn khớp tự động. Lượt làm chưa bị trừ và bài làm vẫn được giữ; hãy rút ngắn câu trả lời rồi nộp lại.`
    : `${oversized.length === 1 ? 'One answer is' : `${oversized.length} answers are`} longer than the ${limit}-character limit for automatically matched short answers. No attempt was consumed and your answers were kept; shorten them and submit again.`;
  return new ApiError(422, 'QUIZ_ANSWER_TOO_LONG', summary, oversized.map((entry) => ({
    path: ['answers', entry.questionId],
    message: detail(entry).en,
    code: 'QUIZ_ANSWER_TOO_LONG',
    severity: 'error' as const,
    pointer: `/answers/${entry.questionId}`,
    localizedMessage: detail(entry),
  })));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function answersForQuiz(questionIds: readonly string[], answers: Record<string, unknown>) {
  const filtered = Object.create(null) as Record<string, unknown>;
  for (const questionId of questionIds) {
    if (Object.hasOwn(answers, questionId)) filtered[questionId] = answers[questionId];
  }
  return filtered;
}

function correctQuestionCount(results: readonly QuestionResult[]): number {
  return results.reduce((total, result) => total + (
    result.children?.length
      ? correctQuestionCount(result.children)
      : result.status === 'correct' ? 1 : 0
  ), 0);
}

async function runPostCommitEffects(
  effects: Array<{ name: string; run: () => Promise<void> }>,
  context: Record<string, string>,
) {
  const correlationId = globalThis.crypto.randomUUID();
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (error) {
      // The attempt is already durable, so downstream recovery must not
      // turn a successful submission into a retryable client failure.
      console.error('Quiz post-commit side effect failed', {
        effect: effect.name,
        ...context,
        correlationId,
        error,
      });
    }
  }
}

export function createQuizService(_dependencies: {
  database: QuizDatabase;
  hooks?: ProgressHooks;
  defaultLocale?: Locale;
}): QuizService {
  const { database, defaultLocale = 'vi' } = _dependencies;
  const hooks = _dependencies.hooks ?? { recompute: async () => undefined };

  async function loadQuiz(
    actor: QuizActor,
    courseId: string,
    itemId: string,
    quizId: string,
  ): Promise<QuizContext> {
    const enrollmentResult = await database
      .from('enrollments')
      .select('course_version_id,branch_id,branch_scope_known')
      .eq('user_id', actor.id)
      .eq('course_id', courseId)
      .in('status', ['active', 'completed'])
      .maybeSingle();
    if (enrollmentResult.error) throw databaseError('Unable to load quiz enrollment');
    if (!isRecord(enrollmentResult.data) || typeof enrollmentResult.data.course_version_id !== 'string') {
      throw new ApiError(404, 'ENROLLMENT_NOT_FOUND', 'Active enrollment not found');
    }
    await assertEnrollmentMembershipAccess({userId:actor.id,roles:[]},enrollmentResult.data,database as unknown as MembershipAccessDatabase);

    const courseVersionId = enrollmentResult.data.course_version_id;
    const itemResult = await database
      .from('course_version_items')
      .select('grading')
      .eq('version_id', courseVersionId)
      .eq('item_id', itemId)
      .maybeSingle();
    if (itemResult.error) throw databaseError('Unable to load quiz grading data');
    if (!isRecord(itemResult.data) || !isRecord(itemResult.data.grading)) {
      throw new ApiError(404, 'ITEM_NOT_FOUND', 'Course item not found');
    }

    const grading = itemResult.data.grading as unknown as GradingItem;
    const quiz = grading.quizzes?.[quizId];
    if (!quiz) throw new ApiError(404, 'QUIZ_NOT_FOUND', 'Quiz not found');
    return { courseVersionId, grading, quiz };
  }

  function questionInQuiz(context: QuizContext, questionId: string) {
    const visit = (id: string, depth: number, visited: Set<string>): boolean => {
      if (depth > 8 || visited.has(id)) return false;
      visited.add(id);
      if (id === questionId) return true;
      return context.grading.questions[id]?.children
        ?.some((child) => visit(child.id, depth + 1, visited)) ?? false;
    };
    return context.quiz.questionIds.some((id) => visit(id, 0, new Set()));
  }

  return {
    async check(actor, courseId, itemId, quizId, questionId, answer) {
      const context = await loadQuiz(actor, courseId, itemId, quizId);
      if (context.quiz.mode !== 'practice' || context.quiz.feedback !== 'per_question') {
        throw new ApiError(409, 'CHECK_NOT_ALLOWED', 'Question checks are not allowed for this quiz');
      }
      const question = context.grading.questions[questionId];
      if (!question || !questionInQuiz(context, questionId)) {
        throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Quiz question not found');
      }
      if (question.type === 'question_group') {
        throw new ApiError(409, 'CHECK_NOT_ALLOWED', 'Question groups must be checked one question at a time');
      }
      const oversized = findOversizedRegexAnswers([question], { [questionId]: answer });
      if (oversized.length) throw answerTooLong(actor.locale, oversized);
      return {
        ...gradeQuestion(question, answer),
        revealed: buildRevealed(
          context.grading,
          [questionId],
          actor.locale,
          defaultLocale,
          { answers: true, explanations: context.quiz.showExplanations },
        ),
      };
    },
    async submit(actor, courseId, itemId, quizId, answers) {
      const context = await loadQuiz(actor, courseId, itemId, quizId);
      const attemptsResult = await database
        .from('quiz_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', actor.id)
        .eq('course_version_id', context.courseVersionId)
        .eq('item_id', itemId)
        .eq('quiz_id', quizId);
      if (attemptsResult.error) throw databaseError('Unable to count quiz attempts');
      const attemptsUsed = attemptsResult.count ?? 0;
      if (context.quiz.attemptsAllowed > 0 && attemptsUsed >= context.quiz.attemptsAllowed) {
        throw new ApiError(409, 'ATTEMPTS_EXHAUSTED', 'No quiz attempts remain');
      }

      const questions = context.quiz.questionIds.map((questionId) => context.grading.questions[questionId]);
      if (questions.some((question) => !question)) {
        throw new ApiError(500, 'INVALID_GRADING_DATA', 'Quiz grading data is incomplete');
      }
      const filteredAnswers = answersForQuiz(context.quiz.questionIds, answers);
      // Classified before grading: `gradeAll` would fold an over-long answer into the
      // same `pendingManual` signal as legacy content a human must judge.
      const oversized = findOversizedRegexAnswers(questions, filteredAnswers);
      if (oversized.length) throw answerTooLong(actor.locale, oversized);
      const graded = gradeAll(questions, filteredAnswers);
      // Quizzes have no manual-completion workflow. Do not persist a partial
      // automatic total as a final grade or consume the learner's attempt.
      if (graded.pendingManual) {
        throw new ApiError(422, 'QUIZ_REQUIRES_MANUAL_GRADING', actor.locale === 'vi'
          ? 'Bài này không thể chấm hoàn toàn tự động. Lượt làm chưa bị trừ. Hãy liên hệ giảng viên để dùng bài tập hoặc bài thi cho phần chấm tay.'
          : 'This quiz cannot be graded completely automatically. No attempt was consumed. Ask your instructor to use an assignment or exam for manual grading.');
      }
      const passed = context.quiz.passPercent === undefined
        ? undefined
        : graded.percent >= context.quiz.passPercent;
      const reveal = context.quiz.feedback !== 'none';
      const learnerResults = graded.results.map((result) => learnerQuestionResult(result, reveal));
      const attemptNo = attemptsUsed + 1;
      const insertResult = await database
        .from('quiz_attempts')
        .insert({
          user_id: actor.id,
          course_version_id: context.courseVersionId,
          item_id: itemId,
          quiz_id: quizId,
          attempt_no: attemptNo,
          answers: filteredAnswers,
          results: learnerResults,
          points: graded.points,
          max_points: graded.maxPoints,
          percent: graded.percent,
          // Migration 0004 keeps this column non-null; without a threshold, completion follows submission.
          passed: passed ?? false,
        })
        .select('id')
        .single();
      if (insertResult.error) {
        if (insertResult.error.code === '23505') {
          throw new ApiError(409, 'ATTEMPT_CONFLICT', 'A quiz attempt was submitted concurrently');
        }
        throw databaseError('Unable to save quiz attempt');
      }
      if (!isRecord(insertResult.data) || typeof insertResult.data.id !== 'string') {
        throw databaseError('Quiz attempt did not return an id');
      }
      const attemptId = insertResult.data.id;

      const points = Math.min(20, 5 + 2 * correctQuestionCount(graded.results));
      await runPostCommitEffects([
        { name: 'progress.recompute', run: () => hooks.recompute(actor, courseId) },
        ...hooks.awardXp ? [{
          name: 'xp.quiz_submitted',
          run: () => hooks.awardXp!({
            userId: actor.id,
            kind: 'quiz_submitted',
            refType: 'quiz_attempt',
            refId: attemptId,
            points,
          }),
        }] : [],
      ], {
        courseId,
        itemId,
        quizId,
        attemptId,
        courseVersionId: context.courseVersionId,
      });
      return {
        attemptId,
        results: learnerResults,
        points: graded.points,
        maxPoints: graded.maxPoints,
        percent: graded.percent,
        ...(passed === undefined ? {} : { passed }),
        attemptsRemaining: context.quiz.attemptsAllowed === 0
          ? null
          : context.quiz.attemptsAllowed - attemptNo,
        revealed: buildRevealed(
          context.grading,
          context.quiz.questionIds,
          actor.locale,
          defaultLocale,
          { answers: reveal, explanations: reveal && context.quiz.showExplanations },
        ),
      };
    },
  };
}

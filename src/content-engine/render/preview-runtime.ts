import type { CompiledItem, GradingItem } from '../compile';
import { gradeAll, gradeQuestion } from '../grading';
import { localizeDeep } from '../compile/localize';
import type { Locale } from '../schema/common';
import type { RichContent } from '../schema/types';
import type { LessonRuntime, QuizSubmitResult, RevealedInfo } from './runtime';
import type { AssignmentAction, AssignmentSessionResult, AssignmentTarget } from './assignment-contracts';

type QuizLike = { questionIds: string[]; attemptsAllowed: number; feedback: 'per_question' | 'after_submit' | 'none'; showExplanations: boolean; passPercent?: number };

function quizLikeOf(grading: GradingItem, id: string): QuizLike | undefined {
  if (grading.quizzes[id]) return grading.quizzes[id];
  const section = grading.exam?.sections.find((s) => s.id === id);
  return section ? { questionIds: section.questionIds, attemptsAllowed: 0, feedback: 'after_submit', showExplanations: true, passPercent: grading.exam!.passPercent } : undefined;
}

export function buildRevealed(grading: GradingItem, questionIds: string[], locale: Locale, defaultLocale: Locale, opts: { answers: boolean; explanations: boolean }): RevealedInfo {
  const out: RevealedInfo = {};
  const walk = (id: string) => {
    const gq = grading.questions[id]; if (!gq) return;
    if (opts.answers && gq.correctAnswer !== undefined) (out.correctAnswers ??= {})[id] = gq.correctAnswer;
    if (opts.explanations && gq.explanation) (out.explanations ??= {})[id] = localizeDeep(gq.explanation, locale, defaultLocale) as RichContent;
    if (opts.explanations && gq.optionFeedback) (out.optionFeedback ??= {})[id] = Object.fromEntries(Object.entries(gq.optionFeedback).map(([k, v]) => [k, localizeDeep(v, locale, defaultLocale) as RichContent]));
    gq.children?.forEach((c) => walk(c.id));
  };
  questionIds.forEach(walk);
  return out;
}

export function createPreviewRuntime(item: CompiledItem, locale: Locale, defaultLocale: Locale = locale): LessonRuntime & { snapshot(): Record<string, unknown> } {
  const state = new Map<string, unknown>();
  const attempts = new Map<string, number>();
  const assignmentSessions = new Map<string, AssignmentSessionResult>();
  let seq = 0;
  const { grading } = item;
  const assignmentSession = (target: AssignmentTarget): AssignmentSessionResult => {
    const id = target.blockId ?? item.id;
    return assignmentSessions.get(id) ?? {
      locator: { courseId: 'preview', itemId: item.id, blockId: target.blockId },
      courseVersionId: 'preview',
      attemptsUsed: 0,
      submissions: [],
      action: { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 },
    };
  };
  const nextAssignmentAction = (id: string, attemptsUsed: number, latestId: string): AssignmentAction => {
    if (attemptsUsed >= 20) return { allowed: false, reason: 'attempt_limit' };
    const policy = grading.assignments?.[id]?.resubmission ?? 'until_approved';
    if (policy === 'never' || (policy === 'once' && attemptsUsed >= 2)) return { allowed: false, reason: 'policy' };
    return { allowed: true, kind: 'revision', expectedLatestSubmissionId: latestId, nextAttemptNo: attemptsUsed + 1 };
  };
  return {
    mode: 'preview', locale,
    getBlockState: <T,>(id: string) => state.get(id) as T | undefined,
    setBlockState: (id, s) => { state.set(id, s); },
    getAssignmentSession: assignmentSession,
    async refreshAssignmentSession(target) { return assignmentSession(target); },
    snapshot: () => Object.fromEntries(state),
    async submitQuiz(quizId, answers): Promise<QuizSubmitResult> {
      const quiz = quizLikeOf(grading, quizId); if (!quiz) throw new Error(`unknown quiz ${quizId}`);
      const used = attempts.get(quizId) ?? 0;
      if (quiz.attemptsAllowed > 0 && used >= quiz.attemptsAllowed) throw new Error('no attempts remaining');
      attempts.set(quizId, used + 1);
      const gqs = quiz.questionIds.map((id) => grading.questions[id]).filter(Boolean);
      const r = gradeAll(gqs, answers);
      const passed = quiz.passPercent !== undefined ? r.percent >= quiz.passPercent : undefined;
      const prev = state.get(quizId) as { best?: number } | undefined;
      state.set(quizId, { completed: true, best: Math.max(prev?.best ?? 0, r.percent), lastAnswers: answers });
      const reveal = quiz.feedback !== 'none';
      return { attemptId: `preview-${++seq}`, results: r.results, points: r.points, maxPoints: r.maxPoints, percent: r.percent, ...(passed !== undefined ? { passed } : {}), attemptsRemaining: quiz.attemptsAllowed === 0 ? null : quiz.attemptsAllowed - used - 1, revealed: buildRevealed(grading, quiz.questionIds, locale, defaultLocale, { answers: reveal, explanations: reveal && quiz.showExplanations }) };
    },
    async checkQuestion(quizId, questionId, answer) {
      const gq = grading.questions[questionId]; if (!gq) throw new Error(`unknown question ${questionId}`);
      const quiz = quizLikeOf(grading, quizId);
      return { ...gradeQuestion(gq, answer), revealed: buildRevealed(grading, [questionId], locale, defaultLocale, { answers: true, explanations: quiz?.showExplanations ?? true }) };
    },
    async submitAssignment(target, payload) {
      const id = target.blockId ?? item.id;
      const current = assignmentSession(target);
      if (!current.action.allowed) throw new Error(`assignment submission unavailable: ${current.action.reason}`);
      const submissionId = `preview-${++seq}`;
      const submittedAt = new Date().toISOString();
      const previous = assignmentSessions.get(id);
      const submission = { submissionId, attemptNo: (previous?.attemptsUsed ?? 0) + 1, status: 'submitted' as const, submittedAt, payload, files: payload.files ?? [] };
      const session: AssignmentSessionResult = {
        locator: { courseId: 'preview', itemId: item.id, blockId: target.blockId },
        courseVersionId: 'preview',
        attemptsUsed: submission.attemptNo,
        submissions: [submission, ...(previous?.submissions ?? [])],
        action: nextAssignmentAction(id, submission.attemptNo, submissionId),
      };
      assignmentSessions.set(id, session);
      state.set(id, { status: 'submitted', payload, submittedAt });
      return { created: true, session };
    },
    async uploadAssignmentFile(_target, file, options) {
      options?.onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
      return { assetId: `preview_${++seq}`, name: file.name, size: file.size, mime: file.type };
    },
    async uploadFile(file) { return { assetId: `preview_${++seq}`, name: file.name, size: file.size, mime: file.type }; },
    resolveMedia: (ref) => ('url' in ref ? ref.url : `preview://asset/${ref.assetId}`),
    hrefFor: (t) => ('url' in t ? t.url : `#${t.kind}/${t.id}`),
    markViewed: () => { state.set('__viewed', true); },
    onActivityComplete: (blockId) => { const s = (state.get(blockId) as Record<string, unknown> | undefined) ?? {}; state.set(blockId, { ...s, completed: true }); },
  };
}

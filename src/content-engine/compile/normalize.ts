import type { QuizSettings } from '../schema/types';
import type { ExamSettings } from '../schema/exam';
import type { LessonDocument } from '../schema/lesson';
import type { CourseDocument, CompletionRule } from '../schema/course';
import { ACTIVITY_BLOCK_TYPES } from '../schema/activities';
import { walkBlocks } from '../validate/walk';

export type QuizGradingSettings = Required<Omit<QuizSettings, 'passPercent'>> & { passPercent?: number };
export const QUIZ_DEFAULTS = { practice: { attemptsAllowed: 0, feedback: 'per_question' as const }, graded: { attemptsAllowed: 3, feedback: 'after_submit' as const } };
export function normalizeQuizSettings(s: QuizSettings | undefined): QuizGradingSettings {
  const mode = s?.mode ?? 'practice';
  return { mode, attemptsAllowed: s?.attemptsAllowed ?? QUIZ_DEFAULTS[mode].attemptsAllowed, feedback: s?.feedback ?? QUIZ_DEFAULTS[mode].feedback, showExplanations: s?.showExplanations ?? true, shuffleQuestions: s?.shuffleQuestions ?? false, required: s?.required ?? true, ...(s?.passPercent !== undefined ? { passPercent: s.passPercent } : {}) };
}

export interface ExamGradingSettings {
  timeLimitMinutes?: number; attemptsAllowed: number; scoringPolicy: 'best' | 'latest' | 'first' | 'average';
  openAt?: string; closeAt?: string; lateSubmission: 'reject' | 'accept_flagged'; passPercent: number;
  review: { showScore: 'immediately' | 'on_release' | 'never'; showCorrectAnswers: 'immediately' | 'on_release' | 'never'; showExplanations: 'immediately' | 'on_release' | 'never'; releaseAt: string | null };
  shuffleQuestions: boolean; shuffleOptions: boolean; navigation: 'free' | 'sequential'; layout: 'one_per_page' | 'section_per_page' | 'single_page';
  integrity: { logFocusLoss: boolean; logPaste: boolean; requireFullscreen: boolean }; required: boolean;
}
export function normalizeExamSettings(s: ExamSettings | undefined): ExamGradingSettings {
  return {
    ...(s?.timeLimitMinutes !== undefined ? { timeLimitMinutes: s.timeLimitMinutes } : {}),
    attemptsAllowed: s?.attemptsAllowed ?? 1, scoringPolicy: s?.scoringPolicy ?? 'best',
    ...(s?.availability?.openAt ? { openAt: s.availability.openAt } : {}), ...(s?.availability?.closeAt ? { closeAt: s.availability.closeAt } : {}),
    lateSubmission: s?.availability?.lateSubmission ?? 'reject', passPercent: s?.passPercent ?? 50,
    review: { showScore: s?.review?.showScore ?? 'immediately', showCorrectAnswers: s?.review?.showCorrectAnswers ?? 'on_release', showExplanations: s?.review?.showExplanations ?? 'on_release', releaseAt: s?.review?.releaseAt ?? null },
    shuffleQuestions: s?.shuffleQuestions ?? false, shuffleOptions: s?.shuffleOptions ?? false, navigation: s?.navigation ?? 'free', layout: s?.layout ?? 'one_per_page',
    integrity: { logFocusLoss: s?.integrity?.logFocusLoss ?? true, logPaste: s?.integrity?.logPaste ?? true, requireFullscreen: s?.integrity?.requireFullscreen ?? false }, required: s?.required ?? true,
  };
}

export interface ActivityDecl { id: string; type: string; required: boolean }
/** Activities that hold learner state, in document order, with their completion relevance. */
export function activitiesOf(lesson: LessonDocument): ActivityDecl[] {
  const out: ActivityDecl[] = [];
  walkBlocks(lesson.blocks, '/blocks', ({ block }) => {
    if (!(ACTIVITY_BLOCK_TYPES as readonly string[]).includes(block.type)) return;
    const required = block.type === 'quiz' ? normalizeQuizSettings(block.settings).required : block.type === 'assignment' ? block.required ?? true : block.type === 'reflection' ? block.required ?? false : block.type === 'stepper' || block.type === 'flashcards' ? true : block.type === 'resource_link' ? block.required ?? false : false;
    out.push({ id: (block as { id: string }).id, type: block.type, required });
  });
  return out;
}
export const lessonCompletionMode = (lesson: LessonDocument): 'view' | 'activities' => lesson.completion?.mode ?? (activitiesOf(lesson).some((a) => a.required) ? 'activities' : 'view');
export const normalizeCompletion = (course: CourseDocument): { rules: CompletionRule[]; certificate: boolean } => ({ rules: course.completion?.rules ?? [{ type: 'all_items' }], certificate: course.completion?.certificate ?? true });

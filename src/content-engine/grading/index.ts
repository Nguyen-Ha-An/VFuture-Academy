import type { GradingQuestion } from '../compile/project';
import { isManualType } from '../schema/questions';
import type { Grader, QuestionResult } from './types';
import { incomplete, isEmptyAnswer, round2 } from './types';
import { gradeSingleChoice, gradeMultipleChoice, gradeTrueFalse } from './graders/choice';
import { gradeNumeric } from './graders/numeric';
import { gradeShortAnswer } from './graders/short-answer';
import { gradeFillBlank } from './graders/fill-blank';
import { gradeMatching, gradeOrdering, gradeClassification } from './graders/structure';
import { gradeManual } from './graders/manual';
import { gradeGroup } from './graders/group';

export * from './types';
export * from './normalize';
export * from './policy';
export * from './completion';

export const GRADERS: Record<string, Grader> = {
  single_choice: gradeSingleChoice, multiple_choice: gradeMultipleChoice, true_false: gradeTrueFalse,
  fill_blank: gradeFillBlank, short_answer: gradeShortAnswer, numeric: gradeNumeric,
  matching: gradeMatching, ordering: gradeOrdering, classification: gradeClassification,
  essay: gradeManual, upload_answer: gradeManual, code_answer: gradeManual,
};

export function gradeQuestion(gq: GradingQuestion, answer: unknown): QuestionResult {
  if (gq.type === 'question_group') return gradeGroup(gq, answer, gradeQuestion);
  if (gq.selfAssessment) return isEmptyAnswer(answer) ? { ...incomplete(gq), maxPoints: 0 } : { questionId: gq.id, status: 'self_assessed', points: 0, maxPoints: 0 };
  if (isManualType(gq.type)) return gradeManual(gq, answer);
  if (gq.correctAnswer === undefined) return { ...incomplete(gq), maxPoints: 0 }; // defensive: validator prevents this
  const grader = GRADERS[gq.type];
  return grader ? grader(gq, answer) : incomplete(gq);
}

export function gradeAll(gqs: GradingQuestion[], answers: Record<string, unknown>): { results: QuestionResult[]; points: number; maxPoints: number; percent: number; pendingManual: boolean } {
  const results = gqs.map((gq) => gradeQuestion(gq, answers[gq.id]));
  const points = round2(results.reduce((s, r) => s + r.points, 0));
  const maxPoints = results.reduce((s, r) => s + r.maxPoints, 0);
  return { results, points, maxPoints, percent: maxPoints ? round2((points / maxPoints) * 100) : 0, pendingManual: results.some((r) => r.status === 'pending_manual') };
}

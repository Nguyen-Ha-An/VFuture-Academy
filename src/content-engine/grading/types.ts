import type { GradingQuestion } from '../compile/project';

export type ResultStatus = 'correct' | 'incorrect' | 'partial' | 'incomplete' | 'pending_manual' | 'self_assessed';
export type PartStatus = 'correct' | 'incorrect' | 'missing';
export interface QuestionResult { questionId: string; status: ResultStatus; points: number; maxPoints: number; parts?: Record<string, PartStatus>; children?: QuestionResult[] }
export type Grader = (gq: GradingQuestion, answer: unknown) => QuestionResult;

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const isEmptyAnswer = (a: unknown): boolean => a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0) || (typeof a === 'object' && a !== null && !Array.isArray(a) && Object.keys(a).length === 0);
export const incomplete = (gq: GradingQuestion): QuestionResult => ({ questionId: gq.id, status: 'incomplete', points: 0, maxPoints: gq.points });

/** Turn a 0..1 correctness ratio into a result, honouring partialScoring. */
export function fromRatio(gq: GradingQuestion, ratio: number, parts?: Record<string, PartStatus>): QuestionResult {
  const partial = gq.settings.partialScoring ?? false;
  const r = ratio >= 1 ? 1 : partial ? Math.max(0, ratio) : 0;
  const status: ResultStatus = r >= 1 ? 'correct' : r > 0 ? 'partial' : 'incorrect';
  return { questionId: gq.id, status, points: round2(r * gq.points), maxPoints: gq.points, ...(parts ? { parts } : {}) };
}

import type { Grader } from '../types';
import { incomplete, isEmptyAnswer } from '../types';

const hasContent = (a: unknown): boolean => {
  if (typeof a === 'string') return a.trim().length > 0;
  if (Array.isArray(a)) return a.some(hasContent);
  if (a && typeof a === 'object') { const o = a as Record<string, unknown>; return ['text', 'code'].some((k) => typeof o[k] === 'string' && (o[k] as string).trim()) || ['files', 'links'].some((k) => Array.isArray(o[k]) && (o[k] as unknown[]).length > 0); }
  return false;
};

export const gradeManual: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || !hasContent(answer)) return incomplete(gq);
  return { questionId: gq.id, status: 'pending_manual', points: 0, maxPoints: gq.rubricMax ?? gq.points };
};

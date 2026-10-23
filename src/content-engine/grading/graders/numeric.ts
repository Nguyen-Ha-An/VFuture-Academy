import type { Grader } from '../types';
import { fromRatio, incomplete } from '../types';
import { parseNumber } from '../normalize';

export const gradeNumeric: Grader = (gq, answer) => {
  const value = parseNumber(answer, { decimalComma: gq.settings.decimalComma ?? true });
  if (value === null) return incomplete(gq);
  const key = gq.correctAnswer as number;
  const tol = gq.tolerancePercent !== undefined ? Math.abs(key) * gq.tolerancePercent / 100 : gq.tolerance ?? 0;
  return fromRatio(gq, Math.abs(value - key) <= tol + 1e-9 ? 1 : 0);
};

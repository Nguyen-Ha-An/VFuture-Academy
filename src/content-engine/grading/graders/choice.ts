import type { Grader, PartStatus } from '../types';
import { fromRatio, incomplete, isEmptyAnswer } from '../types';

export const gradeSingleChoice: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || typeof answer !== 'string') return incomplete(gq);
  return fromRatio(gq, answer === gq.correctAnswer ? 1 : 0);
};

export const gradeMultipleChoice: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || !Array.isArray(answer) || !answer.every((a) => typeof a === 'string')) return incomplete(gq);
  if (!Array.isArray(gq.correctAnswer) || gq.correctAnswer.length === 0) return incomplete(gq);
  const key = new Set(gq.correctAnswer as string[]);
  const picked = new Set(answer as string[]);
  const parts: Record<string, PartStatus> = {};
  let correct = 0, wrong = 0;
  for (const id of picked) { if (key.has(id)) { correct++; parts[id] = 'correct'; } else { wrong++; parts[id] = 'incorrect'; } }
  for (const id of key) if (!picked.has(id)) parts[id] = 'missing';
  const ratio = Math.max(0, correct - wrong) / key.size;
  return fromRatio(gq, ratio, parts);
};

export const gradeTrueFalse: Grader = (gq, answer) => {
  if (typeof answer !== 'boolean') return incomplete(gq);
  return fromRatio(gq, answer === gq.correctAnswer ? 1 : 0);
};

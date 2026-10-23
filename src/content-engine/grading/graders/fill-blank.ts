import type { Grader, PartStatus } from '../types';
import { fromRatio, incomplete, isEmptyAnswer } from '../types';
import { normalizeText } from '../normalize';

export const gradeFillBlank: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || typeof answer !== 'object' || Array.isArray(answer)) return incomplete(gq);
  const given = answer as Record<string, unknown>;
  const key = gq.correctAnswer as Record<string, string | string[]>;
  const ids = Object.keys(key);
  const exactIds = gq.interactionType === 'word_bank';
  const opts = { caseSensitive: gq.settings.caseSensitive, ignoreAccents: gq.settings.ignoreAccents };
  const parts: Record<string, PartStatus> = {};
  let correct = 0;
  for (const id of ids) {
    const g = given[id];
    if (typeof g !== 'string' || g.trim() === '') { parts[id] = 'missing'; continue; }
    const accepted = ([] as string[]).concat(key[id]);
    const hit = exactIds ? accepted.includes(g) : accepted.some((a) => normalizeText(a, opts) === normalizeText(g, opts));
    parts[id] = hit ? 'correct' : 'incorrect';
    if (hit) correct++;
  }
  if (Object.values(parts).every((p) => p === 'missing')) return incomplete(gq);
  return fromRatio(gq, correct / ids.length, parts);
};

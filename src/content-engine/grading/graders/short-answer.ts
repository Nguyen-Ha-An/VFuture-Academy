import type { Grader, QuestionResult } from '../types';
import { fromRatio, incomplete, isEmptyAnswer } from '../types';
import { normalizeText } from '../normalize';
import { matchSafeRegex } from '../safe-regex';

/**
 * A pattern the bounded engine cannot represent must not silently mark a learner incorrect:
 * the answer is kept and the attempt goes to manual review instead.
 */
const pendingManual = (gq: Parameters<Grader>[0]): QuestionResult => ({ questionId: gq.id, status: 'pending_manual', points: 0, maxPoints: gq.points });

export const gradeShortAnswer: Grader = (gq, answer) => {
  if (isEmptyAnswer(answer) || typeof answer !== 'string') return incomplete(gq);
  const opts = { caseSensitive: gq.settings.caseSensitive, ignoreAccents: gq.settings.ignoreAccents };
  const accepted = gq.correctAnswer as string[];
  const mode = gq.matchMode ?? 'exact';

  if (mode === 'regex') {
    const m = matchSafeRegex(accepted, answer.trim(), { caseSensitive: gq.settings.caseSensitive === true });
    // Neither an unsupported key nor an answer past the engine's input bound is evidence of a
    // wrong answer: authoring and the renderer bound new content, so both mean legacy data a
    // human must judge.
    if (m.status === 'unsupported' || m.status === 'input_too_long') return pendingManual(gq);
    return fromRatio(gq, m.status === 'matched' ? 1 : 0);
  }

  const given = normalizeText(answer, opts);
  const hit = accepted.some((a) => {
    const k = normalizeText(a, opts);
    return mode === 'contains' ? given.includes(k) : given === k;
  });
  return fromRatio(gq, hit ? 1 : 0);
};

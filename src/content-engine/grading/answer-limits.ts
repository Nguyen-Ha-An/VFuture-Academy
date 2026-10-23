import type { GradingQuestion } from '../compile/project';
import { matchSafeRegex, SAFE_REGEX_LIMITS } from './safe-regex';

/**
 * One learner answer the bounded matcher refused because of its length, with the
 * bound it exceeded. `length` is the **trimmed** length, because that is the string
 * `gradeShortAnswer` hands to the matcher.
 */
export interface OversizedAnswer {
  questionId: string;
  length: number;
  limit: number;
}

/**
 * An unsupported answer key and an over-long answer are different failures that the
 * grader collapses into the same `pending_manual` result:
 *
 * - an **unsupported** pattern is a property of the content — a human has to judge the
 *   attempt, and no learner can do anything about it;
 * - an answer past `SAFE_REGEX_LIMITS.inputChars` is a property of **this one answer** —
 *   the quiz is fully auto-gradable and the learner can simply shorten what they wrote.
 *
 * Treating the second as the first blocks submission of a working quiz. This finds the
 * second case only: `matchSafeRegex` is asked for its verdict, so an unsupported key
 * still reports `unsupported` and is left to the manual-grading guard, and nothing here
 * ever marks an answer wrong.
 */
export function findOversizedRegexAnswers(
  questions: readonly GradingQuestion[],
  answers: Record<string, unknown>,
): OversizedAnswer[] {
  const out: OversizedAnswer[] = [];
  for (const question of questions) visit(question, answers[question.id], out);
  return out;
}

function visit(question: GradingQuestion, answer: unknown, out: OversizedAnswer[]): void {
  if (question.type === 'question_group') {
    // Mirrors `gradeGroup`: a child answer is keyed by its composite id or its own id.
    const given = typeof answer === 'object' && answer !== null && !Array.isArray(answer)
      ? answer as Record<string, unknown>
      : {};
    for (const child of question.children ?? []) {
      visit(child, given[child.id] ?? given[child.id.slice(question.id.length + 1)], out);
    }
    return;
  }
  if (question.selfAssessment || question.type !== 'short_answer' || question.matchMode !== 'regex') return;
  if (typeof answer !== 'string') return;
  const trimmed = answer.trim();
  // Short answers cost nothing to check and must not pay for a compile.
  if (trimmed.length <= SAFE_REGEX_LIMITS.inputChars) return;
  const accepted = question.correctAnswer;
  if (!Array.isArray(accepted) || accepted.some((pattern) => typeof pattern !== 'string')) return;
  const match = matchSafeRegex(accepted as string[], trimmed, { caseSensitive: question.settings.caseSensitive === true });
  if (match.status === 'input_too_long') out.push({ questionId: question.id, length: trimmed.length, limit: match.limit });
}

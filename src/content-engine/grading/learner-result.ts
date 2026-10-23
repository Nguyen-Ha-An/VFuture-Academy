import type { QuestionResult } from './types';

/** Part keys can contain the answer key even when the aggregate score is visible. */
export function learnerQuestionResult(result: QuestionResult, answersVisible: boolean): QuestionResult {
  const { parts, children, ...score } = result;
  return {
    ...score,
    ...(answersVisible && parts !== undefined ? { parts } : {}),
    ...(children ? { children: children.map((child) => learnerQuestionResult(child, answersVisible)) } : {}),
  };
}

function withoutParts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutParts);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => key === 'parts' ? [] : [[key, withoutParts(nested)]]));
}

/** Cached submit/check responses must follow the pinned quiz's answer visibility. */
export function learnerQuizState(value: unknown, answersVisible: boolean): unknown {
  if (answersVisible || typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const state = value as Record<string, unknown>;
  const last = state.last;
  const checks = state.checks;
  return {
    ...state,
    ...(typeof last === 'object' && last !== null && !Array.isArray(last)
      ? { last: { ...(last as Record<string, unknown>), results: withoutParts((last as Record<string, unknown>).results), revealed: {} } }
      : {}),
    ...(typeof checks === 'object' && checks !== null && !Array.isArray(checks)
      ? { checks: Object.fromEntries(Object.entries(checks).map(([id, result]) => {
        const safe = withoutParts(result);
        return [id, typeof safe === 'object' && safe !== null && !Array.isArray(safe) ? { ...safe, revealed: {} } : safe];
      })) }
      : {}),
  };
}

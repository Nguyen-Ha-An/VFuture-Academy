import { LEARNER_FORBIDDEN_KEYS } from '@/content-engine/compile/project';
import { quizFeedbackForSettings } from '@/content-engine/schema/activities';
import { randomInt } from 'node:crypto';

const forbidden = new Set<string>([...LEARNER_FORBIDDEN_KEYS, 'grading', 'optionFeedback']);

function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function shuffled<T>(values: readonly T[]): T[] {
  // A public, deterministic seed lets a reader invert the permutation and
  // recover the stored (correct) order. Draw a fresh uniform permutation.
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/**
 * Produces a reviewable document without answer material. Walk every subtree,
 * including settings and display, before a caller resolves a JSON Pointer.
 * Some legacy questions encode the answer in their source array order, so those
 * arrays are shuffled independently of their stored order.
 */
export function redactItemDocument(document: unknown): {
  document: unknown;
  redactedPaths: string[];
} {
  const redactedPaths: string[] = [];

  function visit(value: unknown, pointer: string, feedbackPolicy?: string): unknown {
    if (Array.isArray(value)) {
      return value.map((entry, index) => visit(entry, `${pointer}/${index}`));
    }
    if (value === null || typeof value !== 'object') return value;

    const source = value as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    for (const [key, entry] of Object.entries(source)) {
      const childPointer = `${pointer}/${escapePointerToken(key)}`;
      if (forbidden.has(key) && !(key === 'feedback' && feedbackPolicy !== undefined && entry === feedbackPolicy)) {
        redactedPaths.push(childPointer);
        continue;
      }
      entries.push([key, visit(entry, childPointer, quizFeedbackForSettings(source, key))]);
    }
    // Plain records cross the React server/client boundary. fromEntries also
    // treats every input key as an own data property.
    const copy = Object.fromEntries(entries);

    if (source.type === 'ordering' && Array.isArray(copy.items)) {
      copy.items = shuffled(copy.items);
      redactedPaths.push(`${pointer}/items`);
    }
    if (source.type === 'matching' && Array.isArray(copy.right)) {
      copy.right = shuffled(copy.right);
      redactedPaths.push(`${pointer}/right`);
    }
    return copy;
  }

  return { document: visit(document, ''), redactedPaths };
}

/** True if a pointer would expose an omitted key or an answer-bearing order. */
export function pointsIntoRedaction(pointer: string, redactedPaths: readonly string[]): boolean {
  return redactedPaths.some((path) => pointer === path || pointer.startsWith(`${path}/`));
}

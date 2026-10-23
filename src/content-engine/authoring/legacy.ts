import type { AuthoringIssue } from './semantic';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }
  const a = object(left);
  const b = object(right);
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

function pointerTokens(path: string): string[] | undefined {
  if (path === '') return [];
  if (!path.startsWith('/')) return undefined;
  const encoded = path.slice(1).split('/');
  if (encoded.some((part) => /~(?![01])/.test(part))) return undefined;
  return encoded.map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function sameIdentity(current: unknown, previous: unknown): boolean {
  const a = object(current);
  const b = object(previous);
  if (!a || !b) return true;
  for (const key of ['id', 'kind', 'type']) {
    if ((Object.hasOwn(a, key) || Object.hasOwn(b, key)) && a[key] !== b[key]) return false;
  }
  return true;
}

/** Match an array entry by id, or by its value and occurrence among id-less siblings. */
function matchingIndex(current: unknown[], previous: unknown[], index: number): number | undefined {
  const entry = current[index];
  const id = object(entry)?.id;
  if (typeof id === 'string') {
    if (current.filter((candidate) => object(candidate)?.id === id).length !== 1) return undefined;
    const matches = previous.flatMap((candidate, position) => object(candidate)?.id === id ? [position] : []);
    return matches.length === 1 ? matches[0] : undefined;
  }

  const occurrence = current.slice(0, index + 1).filter((candidate) => sameJson(candidate, entry)).length;
  let seen = 0;
  for (let position = 0; position < previous.length; position++) {
    if (!sameJson(previous[position], entry)) continue;
    seen++;
    if (seen === occurrence) return position;
  }
  return undefined;
}

/** Resolve a pointer in the candidate and base without relying on mutable array positions. */
function matchedPair(
  document: unknown,
  base: unknown,
  tokens: string[],
): { current: unknown; previous: unknown } | undefined {
  let current = document;
  let previous = base;
  for (const token of tokens) {
    if (!sameIdentity(current, previous)) return undefined;
    if (Array.isArray(current) && Array.isArray(previous)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
      const baseIndex = matchingIndex(current, previous, index);
      if (baseIndex === undefined) return undefined;
      current = current[index];
      previous = previous[baseIndex];
      continue;
    }
    const a = object(current);
    const b = object(previous);
    if (!a || !b || !Object.hasOwn(a, token) || !Object.hasOwn(b, token)) return undefined;
    current = a[token];
    previous = b[token];
  }
  return sameIdentity(current, previous) ? { current, previous } : undefined;
}

/**
 * A question owns its rich-content blocks. For lesson fields outside a question,
 * the outer lesson block owns its rich content. Anchoring at the nearest `blocks`
 * token would let an unchanged paragraph mask a changed question or activity.
 */
function ownerTokens(tokens: string[], kind: unknown): string[] {
  let questionEnd = 0;
  for (let end = 2; end <= tokens.length; end++) {
    if (tokens[end - 2] === 'questions' && /^(0|[1-9][0-9]*)$/.test(tokens[end - 1])) questionEnd = end;
  }
  if (questionEnd) return tokens.slice(0, questionEnd);
  if (kind === 'lesson') {
    for (let end = 2; end <= tokens.length; end++) {
      if (tokens[end - 2] === 'blocks' && /^(0|[1-9][0-9]*)$/.test(tokens[end - 1])) return tokens.slice(0, end);
    }
  }
  return [];
}

function unchanged(issue: AuthoringIssue, document: unknown, base: unknown): boolean {
  if (issue.severity !== 'error' || !issue.code.startsWith('E_PROFILE_')) return false;
  if (issue.legacyMode !== 'node' && issue.legacyMode !== 'value') return false;
  const tokens = pointerTokens(issue.path);
  if (!tokens || !object(document) || !object(base)) return false;
  if (issue.legacyMode === 'value' && tokens.length === 0) return false;
  const path = issue.legacyMode === 'node' ? ownerTokens(tokens, object(document)?.kind) : tokens;
  const pair = matchedPair(document, base, path);
  return pair !== undefined && sameJson(pair.current, pair.previous);
}

/** Downgrade only profile errors whose offending legacy construct is untouched. */
export function grandfatherLegacy(
  issues: AuthoringIssue[],
  document: unknown,
  base: unknown,
): AuthoringIssue[] {
  const remaining: AuthoringIssue[] = [];
  const legacyPaths: string[] = [];
  for (const issue of issues) {
    if (unchanged(issue, document, base)) legacyPaths.push(issue.path);
    else remaining.push(issue);
  }
  if (legacyPaths.length) remaining.push({
    code: 'W_PROFILE_LEGACY_UNCHANGED',
    path: legacyPaths[0],
    severity: 'warning',
    message: 'Unchanged legacy profile violations; keep the listed constructs verbatim.',
    meta: { count: legacyPaths.length, paths: JSON.stringify(legacyPaths.slice(0, 20)) },
  });
  return remaining;
}

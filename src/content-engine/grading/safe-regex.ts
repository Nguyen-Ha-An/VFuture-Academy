import { RE2JS } from 're2js';

/**
 * Bounded, non-backtracking regex adapter shared by answer validation, server grading and
 * browser preview. Authored patterns run on RE2 (linear time, no catastrophic backtracking);
 * an expression RE2 cannot represent is rejected with a diagnostic detail and is **never**
 * retried on the native `RegExp` engine.
 */
export const SAFE_REGEX_LIMITS = {
  /** Longest single authored pattern, in characters. Mirrors the short_answer schema cap. */
  patternChars: 500,
  /** Most accepted patterns per question. Mirrors the short_answer schema cap. */
  patterns: 50,
  /** Longest learner answer the matcher will evaluate, in characters. */
  inputChars: 1000,
  /** Most compiled results kept in the process-wide LRU cache. */
  cacheEntries: 256,
} as const;

export type SafeRegexRejectReason = 'unsupported_syntax' | 'pattern_too_long' | 'too_many_patterns';

export interface SafeRegexRejection {
  /** Index in the authored pattern list; `-1` for a rejection about the list as a whole. */
  index: number;
  /** The offending pattern, truncated to the accepted pattern bound. */
  pattern: string;
  reason: SafeRegexRejectReason;
  /** Short engine-supplied description, safe to show as diagnostic detail. */
  detail: string;
}

/** Matching is case-insensitive unless `caseSensitive` is true, as elsewhere in grading. */
export interface SafeRegexFlags { caseSensitive?: boolean }

export interface SafeRegexProgram {
  readonly source: string;
  readonly caseSensitive: boolean;
  /** Search semantics: true when the pattern matches anywhere in `input`. */
  test(input: string): boolean;
}

export type SafeRegexCompileResult =
  | { ok: true; program: SafeRegexProgram }
  | { ok: false; reason: Exclude<SafeRegexRejectReason, 'too_many_patterns'>; detail: string };

export type SafeRegexMatch =
  | { status: 'matched'; index: number }
  | { status: 'no_match' }
  | { status: 'unsupported'; rejections: SafeRegexRejection[] }
  | { status: 'input_too_long'; limit: number };

const cache = new Map<string, SafeRegexCompileResult>();

/** Engine descriptions are already terse; keep them bounded so diagnostics stay readable. */
const detailOf = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : String(e);
  const stripped = raw.replace(/^error parsing regexp:\s*/, '').trim();
  return (stripped || 'pattern is not supported by the safe regex engine').slice(0, 200);
};

/** Rejections travel into diagnostics, so never echo back more than the accepted bound. */
const reportedPattern = (pattern: string): string =>
  pattern.length > SAFE_REGEX_LIMITS.patternChars ? `${pattern.slice(0, SAFE_REGEX_LIMITS.patternChars)}…` : pattern;

const tooManyPatterns = (count: number): SafeRegexRejection => ({
  index: -1,
  pattern: '',
  reason: 'too_many_patterns',
  detail: `${count} accepted patterns; the limit is ${SAFE_REGEX_LIMITS.patterns}`,
});

function build(pattern: string, caseSensitive: boolean): SafeRegexCompileResult {
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch (e) {
    return { ok: false, reason: 'unsupported_syntax', detail: detailOf(e) };
  }
  const program: SafeRegexProgram = {
    source: pattern,
    caseSensitive,
    test: (input) => (typeof input === 'string' && input.length <= SAFE_REGEX_LIMITS.inputChars ? compiled.test(input) : false),
  };
  return { ok: true, program };
}

/**
 * Compile one authored pattern. Never throws and never returns a native `RegExp`.
 * Results (including rejections) are cached LRU-style so a published question does not
 * recompile per attempt. An over-long pattern is refused before the cache is consulted, so an
 * oversized string is never retained as a cache key or value.
 */
export function compileSafeRegex(pattern: string, flags: SafeRegexFlags = {}): SafeRegexCompileResult {
  if (pattern.length > SAFE_REGEX_LIMITS.patternChars) {
    return { ok: false, reason: 'pattern_too_long', detail: `pattern is ${pattern.length} characters; the limit is ${SAFE_REGEX_LIMITS.patternChars}` };
  }
  const caseSensitive = flags.caseSensitive === true;
  const key = `${caseSensitive ? 'S' : 'I'} ${pattern}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const result = build(pattern, caseSensitive);
  cache.set(key, result);
  while (cache.size > SAFE_REGEX_LIMITS.cacheEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return result;
}

/** Compiled-result cache occupancy; exposed for bounds assertions and telemetry. */
export const safeRegexCacheSize = (): number => cache.size;

/**
 * Check an answer key's patterns and report **every** rejection, so a validator can point at
 * each offending pattern rather than stopping at the first.
 */
export function inspectSafeRegexPatterns(patterns: readonly string[], flags: SafeRegexFlags = {}): SafeRegexRejection[] {
  if (patterns.length > SAFE_REGEX_LIMITS.patterns) return [tooManyPatterns(patterns.length)];
  const out: SafeRegexRejection[] = [];
  patterns.forEach((pattern, index) => {
    const r = compileSafeRegex(pattern, flags);
    if (!r.ok) out.push({ index, pattern: reportedPattern(pattern), reason: r.reason, detail: r.detail });
  });
  return out;
}

/**
 * Grading-time match. Every accepted pattern is inspected **before** anything is matched: if
 * any pattern is unsupported the whole answer key is untrustworthy, so `unsupported` is
 * reported even when a sibling pattern would have matched. Callers turn that into manual
 * review rather than an incorrect mark, and the learner's answer is preserved either way.
 */
export function matchSafeRegex(patterns: readonly string[], input: string, flags: SafeRegexFlags = {}): SafeRegexMatch {
  const rejections = inspectSafeRegexPatterns(patterns, flags);
  if (rejections.length) return { status: 'unsupported', rejections };
  if (input.length > SAFE_REGEX_LIMITS.inputChars) return { status: 'input_too_long', limit: SAFE_REGEX_LIMITS.inputChars };
  for (let index = 0; index < patterns.length; index++) {
    const r = compileSafeRegex(patterns[index], flags);
    if (r.ok && r.program.test(input)) return { status: 'matched', index };
  }
  return { status: 'no_match' };
}

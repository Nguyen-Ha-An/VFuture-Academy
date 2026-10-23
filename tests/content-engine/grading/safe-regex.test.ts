import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SAFE_REGEX_LIMITS,
  compileSafeRegex,
  inspectSafeRegexPatterns,
  matchSafeRegex,
  safeRegexCacheSize,
} from '@/content-engine/grading/safe-regex';

const reasons = (rs: { reason: string }[]) => rs.map((r) => r.reason);

describe('compileSafeRegex', () => {
  it('matches with search semantics, not full-string anchoring', () => {
    const r = compileSafeRegex('bcd');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.program.test('abcde')).toBe(true);
    expect(r.program.test('abde')).toBe(false);
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    const insensitive = compileSafeRegex('^gpt-?4');
    const sensitive = compileSafeRegex('^gpt-?4', { caseSensitive: true });
    expect(insensitive.ok && insensitive.program.test('GPT4')).toBe(true);
    expect(sensitive.ok && sensitive.program.test('GPT4')).toBe(false);
    expect(sensitive.ok && sensitive.program.test('gpt-4')).toBe(true);
  });

  it('supports Unicode property classes and Vietnamese case folding', () => {
    const letters = compileSafeRegex('^\\p{L}+$');
    expect(letters.ok && letters.program.test('Hà')).toBe(true);
    expect(letters.ok && letters.program.test('Ha1')).toBe(false);
    const folded = compileSafeRegex('^hà nội$');
    expect(folded.ok && folded.program.test('HÀ NỘI')).toBe(true);
    const han = compileSafeRegex('\\p{Han}');
    expect(han.ok && han.program.test('中文')).toBe(true);
  });

  it('rejects lookaround, backreferences and other unsupported syntax with a diagnostic detail', () => {
    for (const pattern of ['a(?=b)', 'a(?!b)', '(?<=a)b', '(a)\\1', '(?>a)', 'a++', '(?R)', '\\u0041']) {
      const r = compileSafeRegex(pattern);
      expect(r.ok, pattern).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe('unsupported_syntax');
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  it('rejects syntactically invalid patterns', () => {
    const r = compileSafeRegex('(');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported_syntax');
  });

  it('never falls back to a native RegExp for an unsupported pattern', () => {
    // `a(?=b)` matches "ab" under native RegExp; the safe engine must refuse instead.
    expect(new RegExp('a(?=b)').test('ab')).toBe(true);
    expect(matchSafeRegex(['a(?=b)'], 'ab')).toEqual({
      status: 'unsupported',
      rejections: [{ index: 0, pattern: 'a(?=b)', reason: 'unsupported_syntax', detail: expect.any(String) }],
    });
  });

  it('rejects patterns longer than the pattern limit', () => {
    const ok = compileSafeRegex('a'.repeat(SAFE_REGEX_LIMITS.patternChars));
    const tooLong = compileSafeRegex('a'.repeat(SAFE_REGEX_LIMITS.patternChars + 1));
    expect(ok.ok).toBe(true);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.reason).toBe('pattern_too_long');
  });

  it('never matches input longer than the answer limit', () => {
    const r = compileSafeRegex('x');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.program.test('x'.repeat(SAFE_REGEX_LIMITS.inputChars))).toBe(true);
    expect(r.program.test('x'.repeat(SAFE_REGEX_LIMITS.inputChars + 1))).toBe(false);
  });

  it('never retains an over-long pattern in the cache or echoes one back in full', () => {
    const huge = 'a'.repeat(SAFE_REGEX_LIMITS.patternChars * 40);
    const before = safeRegexCacheSize();
    expect(compileSafeRegex(huge).ok).toBe(false);
    expect(compileSafeRegex(huge).ok).toBe(false);
    expect(safeRegexCacheSize()).toBe(before);
    const [rejection] = inspectSafeRegexPatterns([huge]);
    expect(rejection.reason).toBe('pattern_too_long');
    expect(rejection.pattern.length).toBeLessThanOrEqual(SAFE_REGEX_LIMITS.patternChars + 1);
    expect(rejection.detail).toContain(String(huge.length));
  });

  it('caches compiled programs per pattern and case sensitivity, within a bounded cache', () => {
    const a = compileSafeRegex('^cached-probe$');
    const b = compileSafeRegex('^cached-probe$');
    expect(a.ok && b.ok && a.program === b.program).toBe(true);
    const sensitive = compileSafeRegex('^cached-probe$', { caseSensitive: true });
    expect(a.ok && sensitive.ok && a.program === sensitive.program).toBe(false);

    for (let i = 0; i < SAFE_REGEX_LIMITS.cacheEntries + 64; i++) compileSafeRegex(`^bound-${i}$`);
    expect(safeRegexCacheSize()).toBeLessThanOrEqual(SAFE_REGEX_LIMITS.cacheEntries);
  });
});

// Pathological patterns are exercised in safe-regex-pathological.test.ts, which runs them in a
// child process under a hard kill: an in-process timeout cannot interrupt a synchronous spin.

describe('the adapter is the same engine on server and in the browser', () => {
  // Studio previews regex answers client-side, so the adapter and its only dependency must not
  // reach for a server-only API. A bundler would resolve these silently and fail in a browser.
  const nodeOnly = [/\bfrom\s+['"]node:/, /\brequire\(\s*['"]node:/, /\bnew Buffer\b/, /\bBuffer\s*\./, /\bprocess\s*\.\s*(env|cwd|version)\b/];

  it('rejects any Node-only API in the adapter or in re2js', () => {
    const sources = {
      adapter: readFileSync(resolve(__dirname, '../../../src/content-engine/grading/safe-regex.ts'), 'utf8'),
      re2js: readFileSync(resolve(__dirname, '../../../node_modules/re2js/build/index.js'), 'utf8'),
    };
    // Guard the guard: the patterns must actually catch a violation.
    expect(nodeOnly.some((p) => p.test("import { Buffer } from 'node:buffer';"))).toBe(true);
    for (const [name, source] of Object.entries(sources)) {
      for (const pattern of nodeOnly) expect(pattern.test(source), `${name} matches ${pattern}`).toBe(false);
    }
  });

  it('resolves re2js through its browser-safe module entry', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../node_modules/re2js/package.json'), 'utf8'));
    expect(pkg.version).toBe('2.8.6');
    expect(pkg.type).toBe('module');
  });
});

describe('inspectSafeRegexPatterns', () => {
  it('returns no rejections for supported patterns', () => {
    expect(inspectSafeRegexPatterns(['^gpt-?4', '\\p{L}+', 'a|b'])).toEqual([]);
  });

  it('reports every rejected pattern with its authored index', () => {
    const rejections = inspectSafeRegexPatterns(['^ok$', 'a(?=b)', '(', 'b'.repeat(SAFE_REGEX_LIMITS.patternChars + 1)]);
    expect(rejections.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(reasons(rejections)).toEqual(['unsupported_syntax', 'unsupported_syntax', 'pattern_too_long']);
  });

  it('rejects more accepted patterns than the limit allows', () => {
    const patterns = Array.from({ length: SAFE_REGEX_LIMITS.patterns + 1 }, (_, i) => `^p${i}$`);
    const rejections = inspectSafeRegexPatterns(patterns);
    expect(rejections).toEqual([{ index: -1, pattern: '', reason: 'too_many_patterns', detail: expect.any(String) }]);
    expect(inspectSafeRegexPatterns(patterns.slice(0, SAFE_REGEX_LIMITS.patterns))).toEqual([]);
  });
});

describe('matchSafeRegex', () => {
  it('reports the first matching pattern', () => {
    expect(matchSafeRegex(['^no$', '^gpt-?4'], 'GPT4')).toEqual({ status: 'matched', index: 1 });
  });

  it('reports no_match when every pattern is supported and none match', () => {
    expect(matchSafeRegex(['^gpt-?4', '^claude'], 'gpt-3')).toEqual({ status: 'no_match' });
  });

  it('inspects every pattern before matching, so an unsupported sibling wins over a match', () => {
    const r = matchSafeRegex(['a(?=b)', '^gpt-?4'], 'gpt4');
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') expect(r.rejections.map((x) => x.index)).toEqual([0]);
  });

  it('reports unsupported when a pattern could not be compiled and nothing matched', () => {
    const r = matchSafeRegex(['a(?=b)', '^claude'], 'gpt-3');
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') expect(reasons(r.rejections)).toEqual(['unsupported_syntax']);
  });

  it('reports every rejection in the key, not just the first', () => {
    const r = matchSafeRegex(['a(?=b)', '(a)\\1', '^ok$'], 'ok');
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') expect(r.rejections.map((x) => x.index)).toEqual([0, 1]);
  });

  it('reports too_many_patterns without evaluating any pattern', () => {
    const patterns = Array.from({ length: SAFE_REGEX_LIMITS.patterns + 1 }, () => '.');
    const r = matchSafeRegex(patterns, 'anything');
    expect(r.status).toBe('unsupported');
    if (r.status === 'unsupported') expect(reasons(r.rejections)).toEqual(['too_many_patterns']);
  });

  it('reports input_too_long instead of evaluating an over-long answer', () => {
    expect(matchSafeRegex(['.'], 'x'.repeat(SAFE_REGEX_LIMITS.inputChars + 1))).toEqual({
      status: 'input_too_long',
      limit: SAFE_REGEX_LIMITS.inputChars,
    });
  });

  it('reports no_match for an empty pattern list', () => {
    expect(matchSafeRegex([], 'anything')).toEqual({ status: 'no_match' });
  });
});

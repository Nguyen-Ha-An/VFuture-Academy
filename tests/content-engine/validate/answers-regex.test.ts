import { describe, it, expect } from 'vitest';
import { checkQuestion } from '@/content-engine/validate/semantic/answers';
import { SAFE_REGEX_LIMITS } from '@/content-engine/grading/safe-regex';
import type { Question } from '@/content-engine/schema/questions';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const sa = (correctAnswer: string[], over: Record<string, unknown> = {}) =>
  ({ id: 's', type: 'short_answer', content: rc('x'), matchMode: 'regex', correctAnswer, ...over }) as unknown as Question;
const check = (q: Question) => checkQuestion(q, '/q', 'd');
const codes = (q: Question) => check(q).map((d) => d.code);

describe('short_answer regex validation', () => {
  it('accepts patterns the bounded engine supports', () => {
    expect(codes(sa(['^gpt-?4', '\\p{L}+', 'hà nội|hanoi']))).toEqual([]);
  });

  it('rejects a syntactically invalid pattern', () => {
    expect(codes(sa(['(']))).toEqual(['E_ANSWER_SHAPE']);
  });

  it('rejects expressions the bounded engine cannot represent, even though native RegExp accepts them', () => {
    for (const pattern of ['a(?=b)', 'a(?!b)', '(?<=a)b', '(a)\\1', '\\u0041']) {
      expect(new RegExp(pattern).test('') || true).toBe(true); // native accepts these patterns
      expect(codes(sa([pattern])), pattern).toEqual(['E_ANSWER_SHAPE']);
    }
  });

  it('points at each offending pattern by index and explains why', () => {
    const ds = check(sa(['^ok$', 'a(?=b)', '(']));
    expect(ds.map((d) => d.path)).toEqual(['/q/correctAnswer/1', '/q/correctAnswer/2']);
    expect(ds.map((d) => d.meta?.reason)).toEqual(['unsupported_syntax', 'unsupported_syntax']);
    for (const d of ds) {
      expect(d.severity).toBe('error');
      expect(d.message.en).toMatch(/regex/i);
      expect(d.message.vi.length).toBeGreaterThan(0);
    }
  });

  it('rejects a pattern longer than the pattern limit', () => {
    const ds = check(sa(['a'.repeat(SAFE_REGEX_LIMITS.patternChars + 1)]));
    expect(ds.map((d) => d.code)).toEqual(['E_ANSWER_SHAPE']);
    expect(ds[0].meta?.reason).toBe('pattern_too_long');
  });

  it('rejects more accepted patterns than the limit allows, at the answer key itself', () => {
    const ds = check(sa(Array.from({ length: SAFE_REGEX_LIMITS.patterns + 1 }, (_, i) => `^p${i}$`)));
    expect(ds.map((d) => d.code)).toEqual(['E_ANSWER_SHAPE']);
    expect(ds[0].path).toBe('/q/correctAnswer');
    expect(ds[0].meta?.reason).toBe('too_many_patterns');
  });

  it('validates patterns with the question case sensitivity so authors see what learners get', () => {
    expect(codes(sa(['^gpt-?4'], { settings: { caseSensitive: true } }))).toEqual([]);
  });

  it('leaves non-regex match modes alone', () => {
    expect(codes(sa(['a(?=b)', '('], { matchMode: 'exact' }))).toEqual([]);
    expect(codes(sa(['a(?=b)'], { matchMode: 'contains' }))).toEqual([]);
    expect(codes(sa(['a(?=b)'], { matchMode: undefined }))).toEqual([]);
  });
});

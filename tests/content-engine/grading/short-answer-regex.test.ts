import { describe, it, expect } from 'vitest';
import { gradeShortAnswer } from '@/content-engine/grading/graders/short-answer';
import { SAFE_REGEX_LIMITS } from '@/content-engine/grading/safe-regex';
import type { GradingQuestion } from '@/content-engine/compile/project';

const sa = (over: Partial<GradingQuestion> = {}): GradingQuestion => ({
  id: 'q', type: 'short_answer', points: 2, settings: {}, interactionType: 'text', selfAssessment: false, matchMode: 'regex', ...over,
});

describe('short_answer regex grading on the safe engine', () => {
  it('grades the documented ^gpt-?4 pattern case-insensitively', () => {
    const q = sa({ correctAnswer: ['^gpt-?4'] });
    expect(gradeShortAnswer(q, 'GPT4')).toMatchObject({ status: 'correct', points: 2, maxPoints: 2 });
    expect(gradeShortAnswer(q, 'gpt-4')).toMatchObject({ status: 'correct', points: 2 });
    expect(gradeShortAnswer(q, 'gpt-3')).toMatchObject({ status: 'incorrect', points: 0, maxPoints: 2 });
  });

  it('honours caseSensitive and keeps search (not full-match) semantics', () => {
    const sensitive = sa({ correctAnswer: ['^gpt-?4'], settings: { caseSensitive: true } });
    expect(gradeShortAnswer(sensitive, 'GPT4').status).toBe('incorrect');
    expect(gradeShortAnswer(sensitive, 'gpt4').status).toBe('correct');
    const anywhere = sa({ correctAnswer: ['machine learning'] });
    expect(gradeShortAnswer(anywhere, 'it uses machine learning today').status).toBe('correct');
  });

  it('matches Unicode answers and trims surrounding whitespace', () => {
    const q = sa({ correctAnswer: ['^hà nội$'] });
    expect(gradeShortAnswer(q, '  HÀ NỘI  ').status).toBe('correct');
    const letters = sa({ correctAnswer: ['^\\p{L}+$'] });
    expect(gradeShortAnswer(letters, 'Hà').status).toBe('correct');
    expect(gradeShortAnswer(letters, 'Ha1').status).toBe('incorrect');
  });

  it('treats a published unsupported pattern as pending manual review, not incorrect', () => {
    const q = sa({ correctAnswer: ['^(?=.*gpt)4'] });
    const before = JSON.stringify(q);
    const result = gradeShortAnswer(q, 'gpt-4');
    expect(result).toMatchObject({ questionId: 'q', status: 'pending_manual', points: 0, maxPoints: 2 });
    expect(JSON.stringify(q)).toBe(before); // grading never rewrites published content
  });

  it('sends the whole key to manual review when any sibling pattern is unsupported', () => {
    // One unevaluable pattern makes the key untrustworthy, so even a matching sibling must not
    // decide the mark on its own.
    const q = sa({ correctAnswer: ['(?<=a)b', '^gpt-?4'] });
    expect(gradeShortAnswer(q, 'gpt4').status).toBe('pending_manual');
    expect(gradeShortAnswer(q, 'gemini').status).toBe('pending_manual');
  });

  it('keeps honest incorrect marks when every pattern is supported', () => {
    const q = sa({ correctAnswer: ['^claude', '^gpt-?4'] });
    expect(gradeShortAnswer(q, 'claude-3').status).toBe('correct');
    expect(gradeShortAnswer(q, 'gemini')).toMatchObject({ status: 'incorrect', points: 0, maxPoints: 2 });
  });

  it('never uses the native engine as a fallback for an unsupported pattern', () => {
    expect(new RegExp('gpt(?=-4)').test('gpt-4')).toBe(true);
    expect(gradeShortAnswer(sa({ correctAnswer: ['gpt(?=-4)'] }), 'gpt-4').status).toBe('pending_manual');
  });

  it('rejects a pattern longer than the pattern limit as pending manual review', () => {
    const q = sa({ correctAnswer: ['a'.repeat(SAFE_REGEX_LIMITS.patternChars + 1)] });
    expect(gradeShortAnswer(q, 'aaa').status).toBe('pending_manual');
  });

  it('refuses to evaluate more accepted patterns than the limit allows', () => {
    const q = sa({ correctAnswer: Array.from({ length: SAFE_REGEX_LIMITS.patterns + 1 }, () => '.') });
    expect(gradeShortAnswer(q, 'x').status).toBe('pending_manual');
  });

  it('sends an over-long legacy answer to manual review instead of silently marking it incorrect', () => {
    const q = sa({ correctAnswer: ['.'] });
    expect(gradeShortAnswer(q, 'x'.repeat(SAFE_REGEX_LIMITS.inputChars)).status).toBe('correct');
    const answer = 'x'.repeat(SAFE_REGEX_LIMITS.inputChars + 1);
    expect(gradeShortAnswer(q, answer)).toMatchObject({ status: 'pending_manual', points: 0, maxPoints: 2 });
    expect(answer).toHaveLength(SAFE_REGEX_LIMITS.inputChars + 1); // the attempt is never truncated
  });

  it('reports incomplete for missing or non-string answers before touching the engine', () => {
    const q = sa({ correctAnswer: ['^gpt-?4'] });
    for (const answer of [undefined, null, '', 42, ['gpt4']]) expect(gradeShortAnswer(q, answer).status).toBe('incomplete');
  });

  it('awards partial credit settings no differently than before for exact and contains modes', () => {
    const exact = sa({ matchMode: 'exact', correctAnswer: ['Hà Nội', 'Hanoi'], points: 1, settings: { ignoreAccents: true } });
    expect(gradeShortAnswer(exact, 'ha noi').status).toBe('correct');
    expect(gradeShortAnswer(exact, 'saigon').status).toBe('incorrect');
    const contains = sa({ matchMode: 'contains', correctAnswer: ['machine learning'] });
    expect(gradeShortAnswer(contains, 'It is Machine  Learning really').status).toBe('correct');
  });

  it('does not apply regex handling to non-regex match modes', () => {
    const literal = sa({ matchMode: 'exact', correctAnswer: ['a(?=b)'] });
    expect(gradeShortAnswer(literal, 'a(?=b)').status).toBe('correct');
    expect(gradeShortAnswer(literal, 'ab').status).toBe('incorrect');
  });
});

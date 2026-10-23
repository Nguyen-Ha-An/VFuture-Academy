import { describe, it, expect } from 'vitest';
import { fromRatio, isEmptyAnswer } from '@/content-engine/grading/types';
import { gradeSingleChoice, gradeMultipleChoice, gradeTrueFalse } from '@/content-engine/grading/graders/choice';
import { gradeNumeric } from '@/content-engine/grading/graders/numeric';
import { gradeShortAnswer } from '@/content-engine/grading/graders/short-answer';
import type { GradingQuestion } from '@/content-engine/compile/project';

const gq = (over: Partial<GradingQuestion>): GradingQuestion => ({ id: 'q', type: 'single_choice', points: 2, settings: {}, interactionType: 'radio', selfAssessment: false, ...over });

describe('helpers', () => {
  it('isEmptyAnswer', () => {
    for (const v of [undefined, null, '', [], {}]) expect(isEmptyAnswer(v)).toBe(true);
    for (const v of [0, false, 'a', ['a'], { a: 1 }]) expect(isEmptyAnswer(v)).toBe(false);
  });
  it('fromRatio honours partialScoring', () => {
    expect(fromRatio(gq({}), 0.5)).toMatchObject({ status: 'incorrect', points: 0, maxPoints: 2 });
    expect(fromRatio(gq({ settings: { partialScoring: true } }), 0.5)).toMatchObject({ status: 'partial', points: 1 });
    expect(fromRatio(gq({}), 1)).toMatchObject({ status: 'correct', points: 2 });
    expect(fromRatio(gq({ settings: { partialScoring: true }, points: 1 }), 1 / 3)).toMatchObject({ points: 0.33 });
  });
});

describe('single_choice', () => {
  const q = gq({ correctAnswer: 'a' });
  it('grades', () => {
    expect(gradeSingleChoice(q, 'a').status).toBe('correct');
    expect(gradeSingleChoice(q, 'b')).toMatchObject({ status: 'incorrect', points: 0 });
    expect(gradeSingleChoice(q, undefined).status).toBe('incomplete');
    expect(gradeSingleChoice(q, ['a']).status).toBe('incomplete');
  });
});

describe('multiple_choice', () => {
  const q = gq({ type: 'multiple_choice', correctAnswer: ['a', 'c'], points: 4 });
  it('all-or-nothing by default', () => {
    expect(gradeMultipleChoice(q, ['c', 'a']).status).toBe('correct');
    expect(gradeMultipleChoice(q, ['a']).status).toBe('incorrect');
  });
  it('partial = (correct − wrong) / total, floored at 0, with parts', () => {
    const p = { ...q, settings: { partialScoring: true } };
    expect(gradeMultipleChoice(p, ['a'])).toMatchObject({ status: 'partial', points: 2, parts: { a: 'correct', c: 'missing' } });
    expect(gradeMultipleChoice(p, ['a', 'b'])).toMatchObject({ status: 'incorrect', points: 0, parts: { a: 'correct', b: 'incorrect', c: 'missing' } });
    expect(gradeMultipleChoice(p, ['a', 'c', 'b'])).toMatchObject({ status: 'partial', points: 2 });
  });
  it('rejects non-array', () => expect(gradeMultipleChoice(q, 'a').status).toBe('incomplete'));
  it('empty key is incomplete, not a NaN ratio', () => {
    expect(gradeMultipleChoice(gq({ type: 'multiple_choice', correctAnswer: [], points: 4 }), ['a']).status).toBe('incomplete');
  });
});

describe('true_false', () => {
  const q = gq({ type: 'true_false', correctAnswer: false, points: 1 });
  it('grades booleans only', () => {
    expect(gradeTrueFalse(q, false).status).toBe('correct');
    expect(gradeTrueFalse(q, true).status).toBe('incorrect');
    expect(gradeTrueFalse(q, 'false').status).toBe('incomplete');
  });
});

describe('numeric', () => {
  it('uses absolute tolerance, percent tolerance, and comma decimals', () => {
    const q = gq({ type: 'numeric', correctAnswer: 4.14, tolerance: 0.01, points: 1 });
    expect(gradeNumeric(q, '4,14').status).toBe('correct');
    expect(gradeNumeric(q, 4.149).status).toBe('correct');
    expect(gradeNumeric(q, 4.2).status).toBe('incorrect');
    expect(gradeNumeric(gq({ type: 'numeric', correctAnswer: 200, tolerancePercent: 5 }), 209).status).toBe('correct');
    expect(gradeNumeric(gq({ type: 'numeric', correctAnswer: 200, tolerancePercent: 5 }), 211).status).toBe('incorrect');
    expect(gradeNumeric(q, 'abc').status).toBe('incomplete');
    expect(gradeNumeric(gq({ type: 'numeric', correctAnswer: 5 }), 5).status).toBe('correct');
  });
});

describe('short_answer', () => {
  it('exact (normalized), contains, regex; case and accents settings', () => {
    const exact = gq({ type: 'short_answer', correctAnswer: ['Hà Nội', 'Hanoi'], matchMode: 'exact', points: 1 });
    expect(gradeShortAnswer(exact, '  hà nội ').status).toBe('correct');
    expect(gradeShortAnswer(exact, 'ha noi').status).toBe('incorrect');
    expect(gradeShortAnswer({ ...exact, settings: { ignoreAccents: true } }, 'ha noi').status).toBe('correct');
    expect(gradeShortAnswer({ ...exact, settings: { caseSensitive: true } }, 'hà nội').status).toBe('incorrect');
    const contains = gq({ type: 'short_answer', correctAnswer: ['machine learning'], matchMode: 'contains' });
    expect(gradeShortAnswer(contains, 'It is Machine Learning, basically').status).toBe('correct');
    const regex = gq({ type: 'short_answer', correctAnswer: ['^gpt-?4'], matchMode: 'regex' });
    expect(gradeShortAnswer(regex, 'GPT4').status).toBe('correct');
    expect(gradeShortAnswer(regex, 'gpt-3').status).toBe('incorrect');
    expect(gradeShortAnswer(exact, '').status).toBe('incomplete');
    expect(gradeShortAnswer(exact, 42).status).toBe('incomplete');
  });
});

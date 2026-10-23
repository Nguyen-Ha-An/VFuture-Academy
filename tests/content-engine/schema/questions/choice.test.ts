import { describe, it, expect } from 'vitest';
import { SingleChoiceSchema, MultipleChoiceSchema, TrueFalseSchema } from '@/content-engine/schema/questions/choice';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const opt = (id: string, t: string) => ({ id, content: rc(t) });

describe('single_choice', () => {
  const base = { id: 'q1', type: 'single_choice', content: rc('Which?'), options: [opt('a', 'A'), opt('b', 'B')], correctAnswer: 'a' };
  it('accepts a full question with localized stem, feedback and display', () => {
    const q = { ...base, content: { vi: rc('Cái nào?'), en: rc('Which?') }, options: [{ ...opt('a', 'A'), feedback: rc('yes') }, opt('b', 'B')], display: { interactionType: 'button', layout: 'grid_2' }, points: 2, explanation: rc('because'), tags: ['x'], skills: ['ai-literacy'], difficulty: 'easy' };
    const r = SingleChoiceSchema.safeParse(q);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
  it('allows missing correctAnswer structurally (semantic layer decides)', () => {
    const { correctAnswer: _c, ...noKey } = base;
    expect(SingleChoiceSchema.safeParse(noKey).success).toBe(true);
  });
  it('rejects fewer than 2 options, unknown keys, non-string key', () => {
    expect(SingleChoiceSchema.safeParse({ ...base, options: [opt('a', 'A')] }).success).toBe(false);
    expect(SingleChoiceSchema.safeParse({ ...base, foo: 1 }).success).toBe(false);
    expect(SingleChoiceSchema.safeParse({ ...base, correctAnswer: ['a'] }).success).toBe(false);
  });
});

describe('multiple_choice', () => {
  const base = { id: 'q2', type: 'multiple_choice', content: rc('Pick'), options: [opt('a', 'A'), opt('b', 'B'), opt('c', 'C')], correctAnswer: ['a', 'c'], settings: { partialScoring: true } };
  it('accepts', () => expect(MultipleChoiceSchema.safeParse(base).success).toBe(true));
  it('rejects string key and empty key', () => {
    expect(MultipleChoiceSchema.safeParse({ ...base, correctAnswer: 'a' }).success).toBe(false);
    expect(MultipleChoiceSchema.safeParse({ ...base, correctAnswer: [] }).success).toBe(false);
  });
});

describe('true_false', () => {
  it('accepts boolean key and custom labels', () => {
    expect(TrueFalseSchema.safeParse({ id: 'q3', type: 'true_false', content: rc('AI is ML'), correctAnswer: false, labels: { true: { vi: 'Đúng', en: 'True' }, false: { vi: 'Sai', en: 'False' } } }).success).toBe(true);
  });
  it('rejects string key', () => expect(TrueFalseSchema.safeParse({ id: 'q3', type: 'true_false', content: rc('x'), correctAnswer: 'true' }).success).toBe(false));
});

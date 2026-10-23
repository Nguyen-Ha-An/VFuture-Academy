import { describe, it, expect } from 'vitest';
import { QuestionSchema, QuestionGroupSchema, QuestionRefSchema, PoolDrawSchema, QuizQuestionEntrySchema, ExamQuestionEntrySchema, QUESTION_TYPES, AUTO_GRADED_TYPES, MANUAL_TYPES, isQuestionRef, isPoolDraw, bankIdOf } from '@/content-engine/schema/questions';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const sc = (id: string) => ({ id, type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a' });

describe('registry', () => {
  it('has exactly 13 types split into auto and manual', () => {
    expect(QUESTION_TYPES).toHaveLength(13);
    expect([...AUTO_GRADED_TYPES, ...MANUAL_TYPES, 'question_group'].sort()).toEqual([...QUESTION_TYPES].sort());
    expect(MANUAL_TYPES).toEqual(['essay', 'upload_answer', 'code_answer']);
  });
});

describe('question_group', () => {
  it('accepts leaf children and rejects nested groups', () => {
    const g = { id: 'g1', type: 'question_group', sharedContent: rc('Read the passage'), questions: [sc('c1'), { id: 'c2', type: 'essay', content: rc('Explain') }] };
    expect(QuestionGroupSchema.safeParse(g).success).toBe(true);
    expect(QuestionGroupSchema.safeParse({ ...g, questions: [g] }).success).toBe(false);
    expect(QuestionGroupSchema.safeParse({ ...g, display: { layout: 'tabs' } }).success).toBe(true);
    expect(QuestionGroupSchema.safeParse({ ...g, display: { layout: 'carousel' } }).success).toBe(false);
  });
});

describe('QuestionSchema union', () => {
  it('discriminates on type and rejects unknown types', () => {
    expect(QuestionSchema.safeParse(sc('x')).success).toBe(true);
    expect(QuestionSchema.safeParse({ id: 'x', type: 'hangman', content: rc('?') }).success).toBe(false);
  });
});

describe('refs and pools', () => {
  it('accepts bank refs and pool draws', () => {
    expect(QuestionRefSchema.safeParse({ $ref: 'bank:ai-basics-012' }).success).toBe(true);
    expect(QuestionRefSchema.safeParse({ $ref: 'ai-basics-012' }).success).toBe(false);
    expect(PoolDrawSchema.safeParse({ $pool: { id: 'p1', count: 5, filter: { tags: ['prompting'], difficulty: ['medium'] } } }).success).toBe(true);
    expect(PoolDrawSchema.safeParse({ $pool: { id: 'p1', count: 5, from: ['bank:a', 'bank:b'], pointsEach: 2 } }).success).toBe(true);
    expect(PoolDrawSchema.safeParse({ $pool: { id: 'p1', count: 5 } }).success).toBe(false);
    expect(PoolDrawSchema.safeParse({ $pool: { id: 'p1', count: 5, from: ['bank:a'], filter: { tags: ['x'] } } }).success).toBe(false);
  });
  it('quiz entries allow refs but not pools; exam entries allow both', () => {
    expect(QuizQuestionEntrySchema.safeParse({ $ref: 'bank:a' }).success).toBe(true);
    expect(QuizQuestionEntrySchema.safeParse({ $pool: { id: 'p', count: 1, from: ['bank:a'] } }).success).toBe(false);
    expect(ExamQuestionEntrySchema.safeParse({ $pool: { id: 'p', count: 1, from: ['bank:a'] } }).success).toBe(true);
    expect(ExamQuestionEntrySchema.safeParse(sc('q')).success).toBe(true);
  });
  it('helpers', () => {
    expect(isQuestionRef({ $ref: 'bank:a' })).toBe(true);
    expect(isPoolDraw({ $pool: { id: 'p', count: 1, from: ['bank:a'] } })).toBe(true);
    expect(bankIdOf({ $ref: 'bank:ai-basics-012' })).toBe('ai-basics-012');
  });
  it('rejects malformed bank refs', () => {
    expect(isQuestionRef({ $ref: 'nope' })).toBe(false);
    expect(() => bankIdOf({ $ref: 'nope' } as never)).toThrow(/invalid bank ref/);
  });
});

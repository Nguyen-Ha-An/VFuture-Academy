import { describe, it, expect } from 'vitest';
import { FillBlankSchema, ShortAnswerSchema, NumericSchema } from '@/content-engine/schema/questions/text';

const stem = (runs: unknown[]) => ({ blocks: [{ type: 'paragraph', content: runs }] });

describe('fill_blank', () => {
  const base = { id: 'fb1', type: 'fill_blank', content: stem([{ text: 'Capital: ' }, { blank: 'b1' }]), blanks: [{ id: 'b1' }], correctAnswer: { b1: ['Hà Nội', 'Hanoi'] } };
  it('accepts typed, dropdown and word_bank variants', () => {
    expect(FillBlankSchema.safeParse(base).success).toBe(true);
    expect(FillBlankSchema.safeParse({ ...base, blanks: [{ id: 'b1', options: ['Hà Nội', 'Huế'] }], display: { interactionType: 'dropdown' }, correctAnswer: { b1: 'Hà Nội' } }).success).toBe(true);
    expect(FillBlankSchema.safeParse({ ...base, wordBank: [{ id: 'w1', text: 'Hà Nội' }, { id: 'w2', text: { vi: 'Huế', en: 'Hue' } }], display: { interactionType: 'word_bank' }, correctAnswer: { b1: 'w1' } }).success).toBe(true);
  });
  it('rejects non-record key and empty blanks', () => {
    expect(FillBlankSchema.safeParse({ ...base, correctAnswer: 'Hà Nội' }).success).toBe(false);
    expect(FillBlankSchema.safeParse({ ...base, blanks: [] }).success).toBe(false);
  });
});

describe('short_answer', () => {
  it('accepts accepted-answer lists and match modes', () => {
    expect(ShortAnswerSchema.safeParse({ id: 'sa1', type: 'short_answer', content: stem([{ text: 'Name the model type' }]), correctAnswer: ['LLM', 'large language model'], matchMode: 'contains', settings: { ignoreAccents: true } }).success).toBe(true);
  });
  it('rejects a bare string key', () => {
    expect(ShortAnswerSchema.safeParse({ id: 'sa1', type: 'short_answer', content: stem([{ text: 'x' }]), correctAnswer: 'LLM' }).success).toBe(false);
  });
});

describe('numeric', () => {
  it('accepts number key with tolerance and unit', () => {
    expect(NumericSchema.safeParse({ id: 'n1', type: 'numeric', content: stem([{ text: '3 + 1.14' }]), correctAnswer: 4.14, tolerance: 0.01, unit: { vi: 'cm', en: 'cm' }, precision: 2 }).success).toBe(true);
  });
  it('rejects string key and negative tolerance', () => {
    expect(NumericSchema.safeParse({ id: 'n1', type: 'numeric', content: stem([{ text: 'x' }]), correctAnswer: '4' }).success).toBe(false);
    expect(NumericSchema.safeParse({ id: 'n1', type: 'numeric', content: stem([{ text: 'x' }]), correctAnswer: 4, tolerance: -1 }).success).toBe(false);
  });
});

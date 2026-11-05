import { describe, expect, it } from 'vitest';
import type { GradingQuestion } from '@/content-engine/compile';
import { validQuestionAnswer as validExamAnswer } from '@/features/learning/question-answer';

function question(type: GradingQuestion['type']): GradingQuestion {
  return { id: 'section/question', type, points: 1, settings: {}, interactionType: '', selfAssessment: false };
}

describe('pinned exam question answer shapes', () => {
  it.each([
    ['single_choice', 'option-one'], ['multiple_choice', ['one', 'two']],
    ['true_false', true], ['fill_blank', { blank: 'answer' }],
    ['short_answer', 'answer'], ['numeric', '1.5'],
    ['matching', [{ left: 'one', right: 'two' }]], ['ordering', ['one', 'two']],
    ['classification', { item: 'category' }], ['essay', 'x'.repeat(5000)],
    ['upload_answer', { links: [{ url: 'https://example.test/work' }] }],
    ['code_answer', { language: 'python', code: 'print(1)' }],
  ] as const)('accepts renderer shape for %s', (type, value) => {
    expect(validExamAnswer(question(type), value)).toBe(true);
  });
  it('accepts a grouped matching answer under its pinned child identity', () => {
    const group = { ...question('question_group'), children: [{ ...question('matching'), id: 'section/question/child' }] };
    expect(validExamAnswer(group, { 'section/question/child': [{ left: 'a', right: 'b' }] })).toBe(true);
    expect(validExamAnswer(group, { 'section/question/unknown': [{ left: 'a', right: 'b' }] })).toBe(false);
  });
  it('rejects cross-type and malformed answers while allowing an explicit clear', () => {
    expect(validExamAnswer(question('true_false'), { files: [{ assetId: 'foreign' }] })).toBe(false);
    expect(validExamAnswer(question('matching'), [{ left: 'a' }])).toBe(false);
    expect(validExamAnswer(question('code_answer'), { language: 'python', code: 'x', extra: true })).toBe(false);
    expect(validExamAnswer(question('single_choice'), null)).toBe(true);
  });
});

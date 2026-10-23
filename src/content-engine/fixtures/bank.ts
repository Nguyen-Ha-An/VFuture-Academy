import { QuestionBundleSchema, type QuestionBundle } from '../schema/bundle';

const richText = (vi: string, en: string) => ({
  vi: { blocks: [{ type: 'paragraph' as const, content: [{ text: vi }] }] },
  en: { blocks: [{ type: 'paragraph' as const, content: [{ text: en }] }] },
});

const option = (id: string, vi: string, en: string) => ({ id, content: richText(vi, en) });

function bankQuestion(
  number: number,
  tags: string[],
  difficulty: 'easy' | 'medium' | 'hard',
) {
  return {
    id: `ai-basics-00${number}`,
    type: 'single_choice' as const,
    tags,
    difficulty,
    points: 1,
    content: richText(
      `Câu hỏi ngân hàng số ${number}: phát biểu nào đúng về AI?`,
      `Bank question ${number}: which statement about AI is true?`,
    ),
    options: [
      option('a', 'AI học quy luật từ dữ liệu', 'AI learns patterns from data'),
      option('b', 'AI luôn đúng', 'AI is always right'),
      option('c', 'AI không cần dữ liệu', 'AI needs no data'),
    ],
    correctAnswer: 'a',
    explanation: richText(
      'Hệ thống học máy học từ ví dụ.',
      'Machine learning systems learn from examples.',
    ),
  };
}

/** Reusable bank questions referenced by the AI Foundations course fixture. */
export const AI_FOUNDATIONS_BANK_BUNDLE: QuestionBundle = QuestionBundleSchema.parse({
  schemaVersion: 1,
  kind: 'question_bundle',
  id: 'ai-foundations-bank',
  title: { vi: 'Ngân hàng Nền tảng AI', en: 'AI Foundations bank' },
  languages: ['vi', 'en'],
  defaultLanguage: 'vi',
  questions: [
    bankQuestion(1, ['ai-basics'], 'easy'),
    bankQuestion(2, ['ai-basics'], 'easy'),
    bankQuestion(3, ['ai-basics', 'prompting'], 'medium'),
    bankQuestion(4, ['prompting'], 'medium'),
    bankQuestion(5, ['prompting'], 'hard'),
    bankQuestion(6, ['responsible-ai'], 'medium'),
  ],
});

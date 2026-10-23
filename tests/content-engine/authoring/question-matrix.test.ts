import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { authoringQuestionJsonSchema, schemaForAuthoring } from '@/content-engine/authoring';
import { staticProfileContext, type LanguageMode } from '@/content-engine/authoring/context';
import { QUESTION_TYPES } from '@/content-engine/schema/questions';
import { checkQuestion } from '@/content-engine/validate/semantic/answers';
import { validateDocument } from '@/content-engine/validate/structural';
import { validateWorkspace } from '@/content-engine/validate';
import { InMemoryResolver } from '@/content-engine/validate/semantic/refs';

type Mode = Extract<LanguageMode, 'mono' | 'bilingual'>;

function samples(mode: Mode) {
  const label = (text: string) => mode === 'mono' ? text : { vi: text, en: text };
  const rich = (text: string) => {
    const body = { blocks: [{ type: 'paragraph', content: [{ text }] }] };
    return mode === 'mono' ? body : { vi: body, en: body };
  };
  const fillContent = () => {
    const body = { blocks: [{ type: 'paragraph', content: [{ text: 'Answer: ' }, { blank: 'blank-a' }] }] };
    return mode === 'mono' ? body : { vi: body, en: body };
  };
  const base = (id: string, type: string) => ({ id, type, points: 2, content: rich('Prompt'), explanation: rich('Reason') });
  const option = (id: string) => ({ id, content: rich(id) });
  const item = (id: string) => ({ id, content: rich(id) });
  const rubric = { criteria: [{ id: 'quality', name: label('Quality'), maxPoints: 2 }] };
  const choices = [option('a'), option('b')];
  const byType = {
    single_choice: { ...base('q-single', 'single_choice'), options: choices, correctAnswer: 'a' },
    multiple_choice: { ...base('q-multi', 'multiple_choice'), options: choices, correctAnswer: ['a'] },
    true_false: { ...base('q-boolean', 'true_false'), correctAnswer: true },
    fill_blank: { ...base('q-blank', 'fill_blank'), content: fillContent(), blanks: [{ id: 'blank-a' }], correctAnswer: { 'blank-a': ['value'] } },
    short_answer: { ...base('q-short', 'short_answer'), matchMode: 'exact', correctAnswer: ['value'] },
    numeric: { ...base('q-numeric', 'numeric'), correctAnswer: 2 },
    matching: { ...base('q-matching', 'matching'), left: [item('l-a'), item('l-b')], right: [item('r-a'), item('r-b')], correctAnswer: [{ left: 'l-a', right: 'r-a' }, { left: 'l-b', right: 'r-b' }] },
    ordering: { ...base('q-ordering', 'ordering'), items: [item('first'), item('second')], correctAnswer: ['first', 'second'] },
    classification: { ...base('q-classification', 'classification'), categories: [{ id: 'cat-a', label: label('A') }, { id: 'cat-b', label: label('B') }], items: [item('item-a'), item('item-b')], correctAnswer: { 'item-a': 'cat-a', 'item-b': 'cat-b' } },
    essay: { ...base('q-essay', 'essay'), rubric },
    upload_answer: { ...base('q-upload', 'upload_answer'), accepts: ['text'], rubric },
    code_answer: { ...base('q-code', 'code_answer'), language: 'python', rubric },
    question_group: { id: 'q-group', type: 'question_group', sharedContent: rich('Passage'), questions: [{ ...base('group-child', 'true_false'), correctAnswer: true }] },
  };
  return { byType, label };
}

describe('question type profile matrix', () => {
  for (const mode of ['mono', 'bilingual'] as const) {
    it(`admits each of the 13 question types through the full workspace validator (${mode})`, async () => {
      const context = staticProfileContext(mode);
      const { byType, label } = samples(mode);
      const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
      addFormats(ajv);
      for (const type of QUESTION_TYPES) {
        const entry = byType[type];
        const document = { schemaVersion: 1, kind: 'exam', id: 'exam-a', title: label('Exam'),
          sections: [{ id: 'section-a', title: label('Section'), questions: [entry] }] };
        expect(schemaForAuthoring('exam', context).safeParse(document).success, `${mode} ${type} profile`).toBe(true);
        const stored = validateDocument(document, 'exam-a');
        expect(stored.ok, `${mode} ${type} storage`).toBe(true);
        if (stored.ok && stored.kind === 'exam') {
          const storedQuestion = stored.doc.sections[0].questions[0];
          if ('type' in storedQuestion) expect(checkQuestion(storedQuestion, '/sections/0/questions/0', 'exam-a'), `${mode} ${type} answers`).toEqual([]);
        }
        expect(ajv.compile(authoringQuestionJsonSchema(type, context))(entry), `${mode} ${type} Ajv`).toBe(true);
        const workspace = {
          manifest: {
            schemaVersion: 1, kind: 'course', id: 'course-a', title: label('Course'), summary: label('Summary'),
            languages: mode === 'mono' ? ['vi'] : ['vi', 'en'], defaultLanguage: 'vi',
            level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills',
            learningOutcomes: [label('Learn')], access: { scope: 'global' },
            modules: [{ id: 'module-a', title: label('Module'), items: [{ type: 'exam', id: 'exam-a', title: label('Exam') }] }],
          },
          items: { 'exam-a': document },
        };
        const report = await validateWorkspace(workspace, new InMemoryResolver({}), { save: true });
        expect(report.ok, `${mode} ${type} workspace: ${report.errors.map((issue) => `${issue.code} ${issue.path}`).join(', ')}`).toBe(true);
      }
    }, 60_000);

    it(`keeps quizzes auto-graded while allowing auto groups (${mode})`, () => {
      const context = staticProfileContext(mode);
      const { byType, label } = samples(mode);
      for (const type of QUESTION_TYPES) {
        const document = { schemaVersion: 1, kind: 'lesson', id: 'lesson-a', title: label('Lesson'),
          blocks: [{ id: 'quiz-a', type: 'quiz', settings: { mode: 'practice' }, questions: [byType[type]] }] };
        expect(schemaForAuthoring('lesson', context).safeParse(document).success, `${mode} ${type}`)
          .toBe(!['essay', 'upload_answer', 'code_answer'].includes(type));
      }
    });
  }
});

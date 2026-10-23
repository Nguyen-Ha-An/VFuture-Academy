import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { staticProfileContext } from '@/content-engine/authoring/context';
import { authoringBlockJsonSchema, authoringJsonSchema, schemaForAuthoring } from '@/content-engine/authoring';
import { LessonDocumentSchema } from '@/content-engine/schema/lesson';
import { ExamDocumentSchema } from '@/content-engine/schema/exam';
import { AssignmentDocumentSchema } from '@/content-engine/schema/bundle';

const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const single = {
  id: 'question-a', type: 'single_choice', points: 2, content: rich('Question?'), explanation: rich('Because.'),
  options: [{ id: 'a', content: rich('One') }, { id: 'b', content: rich('Two') }], correctAnswer: 'a',
};
const lesson = {
  schemaVersion: 1, kind: 'lesson', id: 'lesson-a', title: 'Lesson',
  blocks: [{ id: 'paragraph-a', type: 'paragraph', content: [{ text: 'Hello' }] },
    { id: 'quiz-a', type: 'quiz', questions: [single], settings: { mode: 'graded', passPercent: 60 } }],
};
const exam = {
  schemaVersion: 1, kind: 'exam', id: 'exam-a', title: 'Exam',
  sections: [{ id: 'section-a', title: 'Section', questions: [single] }],
};
const assignment = {
  schemaVersion: 1, kind: 'assignment', id: 'assignment-a', title: 'Assignment',
  instructions: rich('Do the work.'), submission: { accepts: ['text'] },
  rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 10 }] },
};

function ajvFor(schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe('strict authoring profile', () => {
  const context = staticProfileContext('mono');

  it('accepts minimal profile items that also pass storage', () => {
    for (const [kind, value, storage] of [
      ['lesson', lesson, LessonDocumentSchema], ['exam', exam, ExamDocumentSchema],
      ['assignment', assignment, AssignmentDocumentSchema],
    ] as const) {
      expect(schemaForAuthoring(kind, context).safeParse(value).success, kind).toBe(true);
      expect(storage.safeParse(value).success, `${kind} storage`).toBe(true);
    }
  });

  it('rejects missing answer keys, explanations and points', () => {
    for (const field of ['correctAnswer', 'explanation', 'points'] as const) {
      const question = { ...single };
      delete (question as Record<string, unknown>)[field];
      const candidate = { ...exam, sections: [{ ...exam.sections[0], questions: [question] }] };
      expect(schemaForAuthoring('exam', context).safeParse(candidate).success, field).toBe(false);
    }
  });

  it('forbids new bank refs, pools, unrenderable blocks and manual quiz questions', () => {
    const profile = schemaForAuthoring('lesson', context);
    expect(profile.safeParse({ ...lesson, blocks: [{ id: 'math-a', type: 'math', latex: 'x' }] }).success).toBe(false);
    expect(profile.safeParse({ ...lesson, blocks: [{ ...lesson.blocks[1], questions: [{ $ref: 'bank:unknown' }] }] }).success).toBe(false);
    expect(profile.safeParse({ ...lesson, blocks: [{ ...lesson.blocks[1], questions: [{ id: 'essay-a', type: 'essay' }] }] }).success).toBe(false);
    expect(schemaForAuthoring('exam', context).safeParse({ ...exam, sections: [{ ...exam.sections[0], questions: [{ $pool: {} }] }] }).success).toBe(false);
  });

  it('emits pure JSON Schema with the same accept/reject result', () => {
    const schema = authoringJsonSchema('lesson', context);
    const validate = ajvFor(schema);
    for (const candidate of [lesson, { ...lesson, extra: true }, { ...lesson, blocks: [{ id: 'x', type: 'math', latex: 'x' }] }]) {
      expect(Boolean(validate(candidate))).toBe(schemaForAuthoring('lesson', context).safeParse(candidate).success);
    }
    expect(JSON.stringify(schema)).not.toContain('"anyOf"');
  });

  it('serves a block variant without the full lesson envelope', () => {
    const validate = ajvFor(authoringBlockJsonSchema('paragraph', context));
    expect(validate(lesson.blocks[0])).toBe(true);
    expect(validate(lesson.blocks[1])).toBe(false);
    expect(() => authoringBlockJsonSchema('math', context)).toThrow('Unknown');
  });

  it('has identical Zod input and output contracts with no coercion or defaults', () => {
    for (const mode of ['mono', 'bilingual'] as const) {
      for (const kind of ['lesson', 'exam', 'assignment'] as const) {
        const schema = schemaForAuthoring(kind, staticProfileContext(mode));
        const common = { target: 'draft-2020-12', cycles: 'throw', unrepresentable: 'throw', reused: 'ref' } as const;
        expect(z.toJSONSchema(schema, { ...common, io: 'input' }), `${mode} ${kind}`)
          .toEqual(z.toJSONSchema(schema, { ...common, io: 'output' }));
      }
    }
  });
});

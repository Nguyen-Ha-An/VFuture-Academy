import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { itemRef } from '@/content-engine/diagnostics';
import { SCHEMAS_BY_KIND } from '@/content-engine/schema/document';
import { standaloneContentSchema } from '@/content-engine/schema/json-schema';
import { AUTO_GRADED_TYPES, MANUAL_TYPES, QUESTION_TYPES } from '@/content-engine/schema/questions';
import { InMemoryResolver, validateStandaloneDocument, validateWorkspace } from '@/content-engine/validate';
import { decodeItemImport } from '@/features/studio/content-transfer';

/**
 * The AI quiz kit shows one snippet per question type. Each snippet is a fixture here,
 * and every fixture must survive the exact path an author's JSON takes: the runtime
 * schema, the published JSON Schema, the Studio import codec, standalone validation, a
 * lesson quiz, and a course save. A snippet that only *looks* right would teach an AI
 * to produce rejected content, which is the failure the kit exists to prevent.
 */
const AJV_TIMEOUT_MS = 60_000;
const root = process.cwd();
const read = (path: string) => JSON.parse(readFileSync(join(root, ...path.split('/')), 'utf8')) as Record<string, unknown>;
const snippet = (type: string) => read(`docs/studio/content-schema/examples/questions/${type}.json`);

const AUTO = [...AUTO_GRADED_TYPES, 'question_group'] as const;
const MANUAL = [...MANUAL_TYPES] as const;

const docId = (question: Record<string, unknown>) => `kit-${String(question.type).replaceAll('_', '-')}`;
const exam = (question: Record<string, unknown>) => ({
  schemaVersion: 1, kind: 'exam', id: docId(question), title: 'Bộ mẫu',
  sections: [{ id: 'phan-1', title: 'Phần 1', questions: [question] }],
});
const lessonQuiz = (question: Record<string, unknown>) => ({
  schemaVersion: 1, kind: 'lesson', id: docId(question), title: 'Bộ mẫu',
  blocks: [{ id: 'quiz-1', type: 'quiz', settings: { mode: 'practice', feedback: 'after_submit', showExplanations: true }, questions: [question] }],
});
const course = (item: Record<string, unknown> & { id: string; kind: string }) => ({
  manifest: {
    schemaVersion: 1, kind: 'course', id: 'kit-course', title: 'Khoá mẫu', summary: 'Khoá mẫu', languages: ['vi'], defaultLanguage: 'vi',
    level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Mẫu'], access: { scope: 'global' },
    modules: [{ id: 'mo-dun-1', title: 'Mô-đun 1', items: [{ type: item.kind, id: item.id, title: item.title }] }],
  },
  items: { [item.id]: item },
});
const resolver = () => new InMemoryResolver({});
const isRich = (value: unknown) => typeof value === 'object' && value !== null && Array.isArray((value as { blocks?: unknown }).blocks);

describe('quiz kit question snippets', () => {
  let bundle: ValidateFunction;
  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: true });
    addFormats(ajv);
    bundle = ajv.compile(standaloneContentSchema() as AnySchema);
  }, AJV_TIMEOUT_MS);

  it('has exactly one snippet per question type', () => {
    for (const type of QUESTION_TYPES) expect(snippet(type).type, type).toBe(type);
  });

  it.each(QUESTION_TYPES)('%s snippet follows the kit conventions', (type) => {
    const q = snippet(type);
    expect(typeof q.id).toBe('string');
    expect(isRich(q.content), 'content is RichContent').toBe(true);
    // A group's score is the sum of its children; only leaf questions carry points.
    if (type !== 'question_group') expect(typeof q.points).toBe('number');
    if ((AUTO_GRADED_TYPES as readonly string[]).includes(type)) {
      expect(q.correctAnswer, 'auto-graded snippets carry an answer key').toBeDefined();
      expect(isRich(q.explanation), 'auto-graded snippets carry an explanation').toBe(true);
    }
    if ((MANUAL_TYPES as readonly string[]).includes(type)) {
      expect(Object.hasOwn(q, 'correctAnswer'), 'manual snippets carry no answer key').toBe(false);
      expect(q.rubric, 'manual snippets carry a rubric').toBeDefined();
    }
    if (type === 'question_group') {
      const children = q.questions as Record<string, unknown>[];
      expect(children.length).toBeGreaterThan(1);
      for (const child of children) expect((AUTO_GRADED_TYPES as readonly string[]).includes(child.type as string), String(child.type)).toBe(true);
    }
  });

  it.each(QUESTION_TYPES)('%s snippet is a valid exam question by every check Studio runs', async (type) => {
    const document = exam(snippet(type));
    const zod = SCHEMAS_BY_KIND.exam.safeParse(document);
    expect(zod.success, JSON.stringify(zod.error?.issues.slice(0, 3))).toBe(true);
    expect(bundle(document), JSON.stringify(bundle.errors?.slice(0, 3))).toBe(true);
    const decoded = decodeItemImport(JSON.stringify(document));
    expect(decoded.ok, decoded.ok ? '' : JSON.stringify(decoded.diagnostics.map((d) => [d.code, d.path]))).toBe(true);
    const result = await validateStandaloneDocument(document, itemRef(document.id), resolver());
    expect(result.report.errors.map((d) => [d.code, d.path])).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(AUTO)('%s snippet is accepted inside a lesson quiz', async (type) => {
    const document = lessonQuiz(snippet(type));
    const result = await validateStandaloneDocument(document, itemRef(document.id), resolver());
    expect(result.report.errors.map((d) => [d.code, d.path])).toEqual([]);
  });

  it.each(MANUAL)('%s snippet inside a lesson quiz is refused only because quizzes cannot be graded by hand', async (type) => {
    // The rule the kit must state: essay, upload and code answers belong in an exam.
    const document = lessonQuiz(snippet(type));
    const result = await validateStandaloneDocument(document, itemRef(document.id), resolver());
    expect(result.report.errors.map((d) => d.code)).toEqual(['E_QUIZ_MANUAL_QUESTION']);
  });

  it.each(QUESTION_TYPES)('%s snippet saves inside a course workspace', async (type) => {
    const item = exam(snippet(type));
    const report = await validateWorkspace(course(item), resolver(), { save: true, courseId: 'kit-course' });
    expect(report.errors.map((d) => [d.code, d.docId, d.path])).toEqual([]);
  });
});

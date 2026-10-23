import { describe, expect, it } from 'vitest';

import { compileCourse } from '@/content-engine/compile';
import {
  assertSaveableWorkspace,
  ResolverUnavailableError,
  validateStandaloneDocument,
  validateWorkspace,
  type ReferenceResolver,
} from '@/content-engine/validate';
import type { BankQuestionSnapshot } from '@/content-engine/validate/semantic/refs';

const p = (text: string) => ({ type: 'paragraph', content: [{ text }] });
const rc = (text: string) => ({ blocks: [p(text)] });
const sc = (id: string) => ({ id, type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a' });
const essay = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'essay', content: rc('Explain.'), ...extra });

const manifest = (items: unknown[]) => ({
  schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 'S',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'M', items }],
});
const lessonWithQuiz = (questions: unknown[]) => ({
  schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L1', objectives: ['Learn.'],
  blocks: [p('Body'), { id: 'quiz-1', type: 'quiz', questions }],
});
const quizWorkspace = (questions: unknown[]) => ({
  manifest: manifest([{ type: 'lesson', id: 'l1' }]),
  items: { l1: lessonWithQuiz(questions) },
});
const examWorkspace = (questions: unknown[]) => ({
  manifest: manifest([{ type: 'exam', id: 'e1' }]),
  items: {
    e1: {
      schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E1',
      sections: [{ id: 's1', title: 'S', questions }],
    },
  },
});

const resolverFor = (bank: BankQuestionSnapshot[]): ReferenceResolver => ({
  bankQuestion: async (id) => bank.find((q) => q.id === id) ?? null,
  bankCandidates: async () => [],
  asset: async () => null,
  resourceExists: async () => true,
  opportunityExists: async () => true,
  branchExists: async () => true,
});
const empty = resolverFor([]);
const unavailable: ReferenceResolver = {
  ...empty,
  bankQuestion: () => { throw new ResolverUnavailableError('bankQuestion'); },
};
const snapshot = (id: string, question: Record<string, unknown>): BankQuestionSnapshot =>
  ({ id, versionId: `${id}-v1`, question, type: question.type as string });

const quizErrors = (report: { errors: { code: string; path: string; message: { vi: string; en: string } }[] }) =>
  report.errors.filter((d) => d.code === 'E_QUIZ_MANUAL_QUESTION');

describe('quiz manual-question rule — inline questions', () => {
  it('rejects a manually graded quiz question at its exact pointer, in both languages', async () => {
    const report = await validateWorkspace(quizWorkspace([sc('q1'), essay('q2')]), empty, { publish: true });
    expect(quizErrors(report)).toHaveLength(1);
    const [diagnostic] = quizErrors(report);
    expect(diagnostic.path).toBe('/blocks/1/questions/1/type');
    expect(diagnostic.message.en).toContain('essay');
    expect(diagnostic.message.vi).toContain('essay');
    expect(diagnostic.message.vi).not.toBe(diagnostic.message.en);
    expect(report.ok).toBe(false);
  });

  it.each(['essay', 'upload_answer', 'code_answer'] as const)('rejects %s in a quiz', async (type) => {
    const question = type === 'essay' ? essay('q1')
      : type === 'upload_answer' ? { id: 'q1', type, content: rc('Upload.'), accepts: ['file'] }
        : { id: 'q1', type, content: rc('Code.'), language: 'python' };
    const report = await validateWorkspace(quizWorkspace([question]), empty, { publish: true });
    expect(quizErrors(report).map((d) => d.path)).toEqual(['/blocks/1/questions/0/type']);
  });

  it('reaches a manual question nested inside a question group', async () => {
    const group = { id: 'g1', type: 'question_group', sharedContent: rc('Read.'), questions: [sc('c1'), essay('c2')] };
    const report = await validateWorkspace(quizWorkspace([group]), empty, { publish: true });
    expect(quizErrors(report).map((d) => d.path)).toEqual(['/blocks/1/questions/0/questions/1/type']);
  });

  it('accepts an unscored self-assessment reflection, inline and inside a group', async () => {
    const reflection = essay('q2', { selfAssessment: true, points: 0 });
    const group = { id: 'g1', type: 'question_group', sharedContent: rc('Read.'), questions: [sc('c1'), essay('c2', { selfAssessment: true, points: 0 })] };
    const report = await validateWorkspace(quizWorkspace([sc('q1'), reflection, group]), empty, { publish: true });
    expect(quizErrors(report)).toEqual([]);
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
  });

  it('leaves manually graded exam questions alone', async () => {
    const group = { id: 'g1', type: 'question_group', sharedContent: rc('Read.'), questions: [sc('c1'), essay('c2', { points: 4 })] };
    const report = await validateWorkspace(examWorkspace([sc('q1'), essay('q2', { points: 4 }), group]), empty, { publish: true });
    expect(quizErrors(report)).toEqual([]);
  });
});

describe('quiz manual-question rule — bank references', () => {
  it('rejects a quiz reference that resolves to a manually graded bank question', async () => {
    const resolver = resolverFor([snapshot('bank-essay', essay('bank-essay'))]);
    const report = await validateWorkspace(quizWorkspace([sc('q1'), { $ref: 'bank:bank-essay' }]), resolver, { publish: true });
    expect(quizErrors(report)).toMatchObject([{ path: '/blocks/1/questions/1/$ref' }]);
    expect(quizErrors(report)[0]).toMatchObject({ meta: { type: 'essay', id: 'bank-essay' } });
  });

  it('reaches a manual child of a referenced question group', async () => {
    const group = { id: 'bank-group', type: 'question_group', sharedContent: rc('Read.'), questions: [sc('c1'), essay('c2')] };
    const resolver = resolverFor([snapshot('bank-group', group)]);
    const report = await validateWorkspace(quizWorkspace([{ $ref: 'bank:bank-group' }]), resolver, { publish: true });
    expect(quizErrors(report)).toMatchObject([{ path: '/blocks/1/questions/0/$ref', meta: { type: 'essay', question: 'c2' } }]);
  });

  it('accepts a referenced self-assessment question', async () => {
    const resolver = resolverFor([snapshot('bank-reflect', essay('bank-reflect', { selfAssessment: true, points: 0 }))]);
    const report = await validateWorkspace(quizWorkspace([sc('q1'), { $ref: 'bank:bank-reflect' }]), resolver, { publish: true });
    expect(quizErrors(report)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('never reads an unresolved reference as a clean quiz', async () => {
    const report = await validateWorkspace(quizWorkspace([{ $ref: 'bank:missing' }]), empty, { publish: true });
    expect(report.ok).toBe(false);
    expect(report.errors.map((d) => d.code)).toContain('E_REF_UNRESOLVED');
    expect(quizErrors(report)).toEqual([]);
  });

  it('never reads a failed lookup as a clean quiz', async () => {
    const report = await validateWorkspace(quizWorkspace([{ $ref: 'bank:unknown' }]), unavailable, { publish: true });
    expect(report.ok).toBe(false);
    expect(report.errors.map((d) => d.code)).toContain('E_REFERENCE_LOOKUP_FAILED');
    expect(quizErrors(report)).toEqual([]);
  });

  it('resolves each quiz reference once for the whole operation', async () => {
    let lookups = 0;
    const resolver: ReferenceResolver = {
      ...empty,
      bankQuestion: async (id) => { lookups += 1; return snapshot(id, sc(id)); },
    };
    await validateWorkspace(quizWorkspace([{ $ref: 'bank:shared' }]), resolver, { publish: true });
    expect(lookups).toBe(1);
  });
});

describe('quiz manual-question rule — standalone documents', () => {
  it('rejects a manually graded quiz question in a lone lesson', async () => {
    const result = await validateStandaloneDocument(lessonWithQuiz([sc('q1'), essay('q2')]), 'l1', empty);
    expect(result.ok).toBe(false);
    expect(quizErrors(result.report).map((d) => d.path)).toEqual(['/blocks/1/questions/1/type']);
  });

  it('rejects a lone lesson whose quiz references a manually graded bank question', async () => {
    const resolver = resolverFor([snapshot('bank-essay', essay('bank-essay'))]);
    const result = await validateStandaloneDocument(lessonWithQuiz([{ $ref: 'bank:bank-essay' }]), 'l1', resolver);
    expect(quizErrors(result.report).map((d) => d.path)).toEqual(['/blocks/1/questions/0/$ref']);
  });

  it('reports an unresolvable quiz reference rather than accepting it', async () => {
    const result = await validateStandaloneDocument(lessonWithQuiz([{ $ref: 'bank:missing' }]), 'l1', empty);
    expect(result.ok).toBe(false);
    expect(result.report.errors.map((d) => d.code)).toEqual(['E_REF_UNRESOLVED']);
  });

  it('reports a failed quiz reference lookup rather than accepting it', async () => {
    const result = await validateStandaloneDocument(lessonWithQuiz([{ $ref: 'bank:x' }]), 'l1', unavailable);
    expect(result.ok).toBe(false);
    expect(result.report.errors.map((d) => d.code)).toEqual(['E_REFERENCE_LOOKUP_FAILED']);
  });

  it('accepts a lone lesson whose quiz reflection is self-assessed', async () => {
    const result = await validateStandaloneDocument(lessonWithQuiz([sc('q1'), essay('q2', { selfAssessment: true, points: 0 })]), 'l1', empty);
    expect(result.report.errors, JSON.stringify(result.report.errors)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('quiz manual-question rule — the gates that use it', () => {
  it('refuses a server write and a publication of a workspace whose quiz needs manual grading', async () => {
    const ws = quizWorkspace([sc('q1'), essay('q2')]);
    const saved = await assertSaveableWorkspace(ws, empty, { courseId: 'c' });
    expect(saved.report.ok).toBe(false);
    expect(saved.report.errors.map((d) => d.code)).toContain('E_QUIZ_MANUAL_QUESTION');

    const compiled = await compileCourse(ws, empty, { publish: true });
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((d) => d.code)).toContain('E_QUIZ_MANUAL_QUESTION');
  });

  it('lets the same workspace through once the reflection is self-assessed', async () => {
    const ws = quizWorkspace([sc('q1'), essay('q2', { selfAssessment: true, points: 0 })]);
    expect((await assertSaveableWorkspace(ws, empty, { courseId: 'c' })).report.ok).toBe(true);
    expect((await compileCourse(ws, empty, { publish: true })).ok).toBe(true);
  });
});

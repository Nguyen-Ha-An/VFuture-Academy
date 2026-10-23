import { describe, it, expect } from 'vitest';

import { COURSE_REF, itemRef } from '@/content-engine/diagnostics';
import {
  InMemoryResolver,
  checkStandaloneRendererSupport,
  validateStandaloneDocument,
  validateWorkspace,
} from '@/content-engine/validate';
import { validateDocument } from '@/content-engine/validate/structural';

/**
 * A course and a standalone save must answer "can anything render this?" the same way.
 *
 * They did not: the workspace pass walked an item's own block tree and its question
 * player types, so a reserved block nested in rich content — an exam question's stem,
 * an assignment's instructions, a quiz intro — travelled inside a course while the
 * identical bytes were rejected when saved on their own.
 */
const reserved = { type: 'math', latex: 'x^2' };
const rc = (blocks: unknown[]) => ({ blocks });
const resolver = new InMemoryResolver({});

const course = (items: unknown[]) => ({
  schemaVersion: 1, kind: 'course', id: 'parity', title: 'Parity', summary: 'Parity.',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Render.'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'M', items }],
});

const examWithReservedStem = {
  schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E',
  sections: [{
    id: 's1', title: 'S',
    questions: [{ id: 'q1', type: 'true_false', content: rc([reserved]), correctAnswer: true }],
  }],
};

const assignmentWithReservedInstructions = {
  schemaVersion: 1, kind: 'assignment', id: 'a1', title: 'A',
  instructions: rc([reserved]), submission: { accepts: ['text'] },
};

const lessonWithReservedQuizIntro = {
  schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', objectives: ['Render.'],
  blocks: [{
    id: 'quiz-1', type: 'quiz', intro: rc([reserved]),
    questions: [{ id: 'q1', type: 'true_false', content: rc([{ type: 'paragraph', content: [{ text: '?' }] }]), correctAnswer: true }],
  }],
};

const cases: [string, { type: string; id: string }, Record<string, unknown>, string][] = [
  ['an exam question stem', { type: 'exam', id: 'e1' }, examWithReservedStem, '/sections/0/questions/0/content/blocks/0'],
  ['assignment instructions', { type: 'assignment', id: 'a1' }, assignmentWithReservedInstructions, '/instructions/blocks/0'],
  ['a quiz intro', { type: 'lesson', id: 'l1' }, lessonWithReservedQuizIntro, '/blocks/0/intro/blocks/0'],
];

describe('a reserved block in nested rich content is rejected in both shapes', () => {
  it.each(cases)('%s, standalone', async (_label, stub, document, path) => {
    const result = await validateStandaloneDocument(document, itemRef(stub.id), resolver);
    expect(result.ok).toBe(false);
    expect(result.report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'E_RENDERER_UNSUPPORTED', docId: stub.id, path, meta: expect.objectContaining({ type: 'math' }) }),
    ]));
  });

  it.each(cases)('%s, inside a course being saved', async (_label, stub, document, path) => {
    const report = await validateWorkspace(
      { manifest: course([stub]), items: { [stub.id]: document } },
      resolver,
      { save: true, courseId: 'parity' },
    );
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'E_RENDERER_UNSUPPORTED', docId: stub.id, path, meta: expect.objectContaining({ type: 'math' }) }),
    ]));
  });

  it.each(cases)('%s is reported once, not once per pass', async (_label, stub, document, path) => {
    const report = await validateWorkspace(
      { manifest: course([stub]), items: { [stub.id]: document } },
      resolver,
      { save: true, courseId: 'parity' },
    );
    const matching = [...report.errors, ...report.warnings]
      .filter((d) => d.code === 'E_RENDERER_UNSUPPORTED' && d.path === path);
    expect(matching).toHaveLength(1);
  });

  it.each(cases)('%s is a warning on a read path and an error on a save', async (_label, stub, document, path) => {
    const workspace = { manifest: course([stub]), items: { [stub.id]: document } };
    const read = await validateWorkspace(workspace, resolver, { courseId: 'parity' });
    expect(read.warnings.map((d) => `${d.code}${d.path}`)).toContain(`E_RENDERER_UNSUPPORTED${path}`);
    expect(read.errors.map((d) => d.code)).not.toContain('E_RENDERER_UNSUPPORTED');

    const publishing = await validateWorkspace(workspace, resolver, { publish: true, courseId: 'parity' });
    expect(publishing.errors.map((d) => `${d.code}${d.path}`)).toContain(`E_RENDERER_UNSUPPORTED${path}`);
  });
});

describe('the parity is one shared implementation, not two', () => {
  it('reports the same paths from the helper directly as the workspace pass does', async () => {
    const structural = validateDocument(examWithReservedStem, itemRef('e1'));
    if (!structural.ok) throw new Error('fixture must validate structurally');
    const direct = checkStandaloneRendererSupport(structural.doc, itemRef('e1')).map((d) => d.path);

    const report = await validateWorkspace(
      { manifest: course([{ type: 'exam', id: 'e1' }]), items: { e1: examWithReservedStem } },
      resolver,
      { save: true, courseId: 'parity' },
    );
    const viaWorkspace = report.errors.filter((d) => d.code === 'E_RENDERER_UNSUPPORTED').map((d) => d.path);
    expect(viaWorkspace).toEqual(expect.arrayContaining(direct));
  });

  it('leaves a renderable course clean in both shapes', async () => {
    const lesson = {
      schemaVersion: 1, kind: 'lesson', id: 'ok', title: 'Fine', objectives: ['Render.'],
      blocks: [{ type: 'paragraph', content: [{ text: 'All renderable' }] }],
    };
    const standalone = await validateStandaloneDocument(lesson, itemRef('ok'), resolver);
    expect(standalone.report.errors).toEqual([]);

    const report = await validateWorkspace(
      { manifest: course([{ type: 'lesson', id: 'ok' }]), items: { ok: lesson } },
      resolver,
      { save: true, courseId: 'parity' },
    );
    expect(report.errors.filter((d) => d.code === 'E_RENDERER_UNSUPPORTED')).toEqual([]);
  });

  it('yields nothing for a course document, which has no standalone body of its own', () => {
    const structural = validateDocument(course([{ type: 'lesson', id: 'l1' }]), COURSE_REF);
    if (!structural.ok) throw new Error('fixture must validate structurally');
    expect(checkStandaloneRendererSupport(structural.doc, COURSE_REF)).toEqual([]);
  });
});

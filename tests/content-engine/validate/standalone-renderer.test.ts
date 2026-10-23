import { describe, expect, it } from 'vitest';
import { checkStandaloneRendererSupport } from '@/content-engine/validate/standalone-renderer';
import { itemRef } from '@/content-engine/diagnostics';
import type { AnyDocument } from '@/content-engine/schema/document';

const ref = itemRef('d');
const check = (doc: unknown) => checkStandaloneRendererSupport(doc as AnyDocument, ref);
const paths = (doc: unknown) => check(doc).map((d) => d.path);
const types = (doc: unknown) => check(doc).map((d) => d.meta?.type);

const math = { type: 'math', latex: 'x^2' };
const diagram = { type: 'diagram', src: { assetId: 'asset_a' }, alt: 'a' };
const para = (text = 'ok') => ({ type: 'paragraph', content: [{ text }] });
const rc = (...blocks: unknown[]) => ({ blocks });

const resource = (body: unknown) => ({ schemaVersion: 1, kind: 'resource', id: 'r', title: 'T', summary: 'S', resourceType: 'guide', body });
const lesson = (blocks: unknown[]) => ({ schemaVersion: 1, kind: 'lesson', id: 'l', title: 'T', blocks });
const exam = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, kind: 'exam', id: 'e', title: 'T',
  sections: [{ id: 's1', title: 'S', questions: [choice()] }], ...over,
});
const bundle = (questions: unknown[]) => ({ schemaVersion: 1, kind: 'question_bundle', id: 'b', questions });
const assignment = (instructions: unknown) => ({
  schemaVersion: 1, kind: 'assignment', id: 'a', title: 'T', instructions, submission: { accepts: ['text'] },
});
const choice = (over: Record<string, unknown> = {}) => ({
  id: 'q1', type: 'single_choice', content: rc(para('?')),
  options: [{ id: 'a', content: rc(para('A')) }, { id: 'b', content: rc(para('B')) }], correctAnswer: 'a', ...over,
});

describe('unsupported blocks in standalone resource bodies', () => {
  it('reports a reserved block that resource save currently accepts', () => {
    const ds = check(resource(rc(math)));
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ code: 'E_RENDERER_UNSUPPORTED', severity: 'error', path: '/body/blocks/0', meta: { type: 'math' } });
    expect(ds[0].docId).toBe('d');
  });

  it('reports an unsupported block nested inside a callout', () => {
    expect(paths(resource(rc(para(), { type: 'callout', variant: 'info', blocks: [para(), diagram] })))).toEqual(['/body/blocks/1/blocks/1']);
  });

  it('reports unsupported blocks per locale in a localized body', () => {
    const ds = check(resource({ vi: rc(math), en: rc(para(), diagram) }));
    expect(ds.map((d) => d.path).sort()).toEqual(['/body/en/blocks/1', '/body/vi/blocks/0']);
    expect(ds.map((d) => d.meta?.type).sort()).toEqual(['diagram', 'math']);
  });

  it('accepts a body made only of renderable blocks', () => {
    expect(check(resource(rc(para(), { type: 'divider' }, { type: 'callout', variant: 'tip', blocks: [para()] })))).toEqual([]);
  });
});

describe('unsupported blocks in standalone lessons', () => {
  it('reports a top-level reserved block', () => {
    expect(paths(lesson([para(), math]))).toEqual(['/blocks/1']);
  });

  it('reports blocks nested in every container kind', () => {
    expect(paths(lesson([{ id: 'acc', type: 'accordion', items: [{ id: 'i1', title: 'T', blocks: [math] }] }]))).toEqual(['/blocks/0/items/0/blocks/0']);
    expect(paths(lesson([{ id: 'st', type: 'stepper', steps: [{ id: 's1', title: 'T', blocks: [para(), diagram] }] }]))).toEqual(['/blocks/0/steps/0/blocks/1']);
    expect(paths(lesson([{ id: 'rv', type: 'reveal', label: 'L', blocks: [math] }]))).toEqual(['/blocks/0/blocks/0']);
    expect(paths(lesson([{ id: 'tb', type: 'tabs', items: [{ id: 't1', title: 'T', blocks: [math] }] }]))).toEqual(['/blocks/0/items/0/blocks/0']);
  });

  it('reports unsupported blocks inside activity rich content', () => {
    expect(paths(lesson([{ id: 'quiz-1', type: 'quiz', intro: rc(math), questions: [choice()] }]))).toEqual(['/blocks/0/intro/blocks/0']);
    expect(paths(lesson([{ id: 'ref-1', type: 'reflection', prompt: rc(para(), math) }]))).toEqual(['/blocks/0/prompt/blocks/1']);
    expect(paths(lesson([{ id: 'fc', type: 'flashcards', cards: [{ id: 'c1', front: rc(math), back: rc(diagram) }] }])))
      .toEqual(['/blocks/0/cards/0/front/blocks/0', '/blocks/0/cards/0/back/blocks/0']);
    expect(paths(lesson([{ id: 'as', type: 'assignment', title: 'T', instructions: rc(math), submission: { accepts: ['text'] } }]))).toEqual(['/blocks/0/instructions/blocks/0']);
  });

  it('accepts a lesson whose blocks and activities are all renderable', () => {
    expect(check(lesson([para(), { id: 'quiz-1', type: 'quiz', intro: rc(para()), questions: [choice()] }]))).toEqual([]);
  });
});

describe('unsupported question players in standalone documents', () => {
  it('reports an interaction type no player implements', () => {
    const ds = check(bundle([choice({ display: { interactionType: 'circle' } })]));
    expect(ds).toMatchObject([{ code: 'E_RENDERER_UNSUPPORTED', path: '/questions/0', meta: { type: 'single_choice:circle' } }]);
  });

  it('names the default player when no interaction type is declared', () => {
    expect(types(bundle([{ ...choice(), type: 'unknown_type' }]))).toEqual(['unknown_type:default']);
  });

  it('reports players inside lesson quizzes and exam sections', () => {
    expect(paths(lesson([{ id: 'quiz-1', type: 'quiz', questions: [choice({ display: { interactionType: 'circle' } })] }]))).toEqual(['/blocks/0/questions/0']);
    expect(paths(exam({ sections: [{ id: 's1', title: 'S', questions: [choice({ display: { interactionType: 'circle' } })] }] }))).toEqual(['/sections/0/questions/0']);
  });

  it('reports a group child player and shared content', () => {
    const group = { id: 'g', type: 'question_group', sharedContent: rc(math), questions: [choice({ display: { interactionType: 'circle' } })] };
    const ds = check(bundle([group]));
    expect(ds.map((d) => d.path).sort()).toEqual(['/questions/0/questions/0', '/questions/0/sharedContent/blocks/0']);
  });

  it('accepts every player in the manifest, including non-default interaction types', () => {
    expect(check(bundle([choice({ display: { interactionType: 'button' } }), choice({ id: 'q2', display: { interactionType: 'dropdown' } })]))).toEqual([]);
  });
});

describe('unsupported blocks in question rich content', () => {
  it('reports the stem, explanation and hint', () => {
    expect(paths(bundle([choice({ content: rc(math), explanation: rc(diagram), hint: rc(math) })])).sort())
      .toEqual(['/questions/0/content/blocks/0', '/questions/0/explanation/blocks/0', '/questions/0/hint/blocks/0']);
  });

  it('reports option content and feedback', () => {
    const q = choice({ options: [{ id: 'a', content: rc(math), feedback: rc(diagram) }, { id: 'b', content: rc(para()) }] });
    expect(paths(bundle([q])).sort()).toEqual(['/questions/0/options/0/content/blocks/0', '/questions/0/options/0/feedback/blocks/0']);
  });

  it('reports matching, ordering and classification item content', () => {
    const item = (id: string, blocks: unknown[]) => ({ id, content: { blocks } });
    const matching = { id: 'm', type: 'matching', content: rc(para()), left: [item('l1', [math])], right: [item('r1', [para()])], correctAnswer: [{ left: 'l1', right: 'r1' }] };
    expect(paths(bundle([matching]))).toEqual(['/questions/0/left/0/content/blocks/0']);
    const ordering = { id: 'o', type: 'ordering', content: rc(para()), items: [item('a', [para()]), item('b', [diagram])], correctAnswer: ['a', 'b'] };
    expect(paths(bundle([ordering]))).toEqual(['/questions/0/items/1/content/blocks/0']);
  });
});

describe('exam and assignment bodies', () => {
  it('reports the exam description and section instructions', () => {
    const ds = check(exam({ description: rc(math), sections: [{ id: 's1', title: 'S', instructions: rc(diagram), questions: [choice()] }] }));
    expect(ds.map((d) => d.path).sort()).toEqual(['/description/blocks/0', '/sections/0/instructions/blocks/0']);
  });

  it('reports assignment instructions', () => {
    expect(paths(assignment(rc(para(), math)))).toEqual(['/instructions/blocks/1']);
  });

  it('accepts renderable exam and assignment bodies', () => {
    expect(check(exam({ description: rc(para()) }))).toEqual([]);
    expect(check(assignment(rc(para())))).toEqual([]);
  });
});

describe('scope of the helper', () => {
  it('invents no course scaffold and reports nothing for a course document', () => {
    const course = { schemaVersion: 1, kind: 'course', id: 'c', title: 'T', modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }] };
    expect(check(course)).toEqual([]);
  });

  it('is pure: it never mutates the document it inspects', () => {
    const doc = resource(rc(math, para()));
    const before = JSON.stringify(doc);
    check(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('survives partially-shaped rich content without throwing', () => {
    for (const body of [undefined, null, {}, { blocks: undefined }, { vi: null }]) {
      expect(() => check(resource(body))).not.toThrow();
    }
  });

  it('attributes every diagnostic to the document reference it was given', () => {
    const other = itemRef('other-doc');
    const ds = checkStandaloneRendererSupport(resource(rc(math)) as unknown as AnyDocument, other);
    expect(ds.map((d) => d.docId)).toEqual(['other-doc']);
  });
});

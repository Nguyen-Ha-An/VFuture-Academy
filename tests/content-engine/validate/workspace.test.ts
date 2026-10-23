import { describe, it, expect } from 'vitest';
import { parseWorkspace, splitInlineCourse, inlineWorkspace, workspaceFromDocuments } from '@/content-engine/validate/workspace';
import { CourseDocumentSchema, type CourseDocument } from '@/content-engine/schema/course';

const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const manifest = { schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 's', languages: ['vi'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1', title: 'Inline lesson', blocks: [p('a')] }, { type: 'lesson', id: 'l2' }, { type: 'exam', id: 'e1', title: 'E', sections: [{ id: 's', title: 'S', questions: [{ id: 'q', type: 'true_false', content: { blocks: [p('?')] }, correctAnswer: true }] }] }] }] };
const l2 = { schemaVersion: 1, kind: 'lesson', id: 'l2', title: 'L2', blocks: [p('b')] };

describe('workspace', () => {
  it('parses manifest and items with docIds', () => {
    const r = parseWorkspace({ manifest, items: { l2 } });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.parsed!.items).sort()).toEqual(['e1', 'l1', 'l2']);
    expect(r.parsed!.manifest.modules[0].items[0]).toEqual({ type: 'lesson', id: 'l1', title: 'Inline lesson' });
    expect(r.parsed!.invalidItemIds).toEqual([]);
  });
  it('reports item errors under the item docId and records the id as invalid', () => {
    const r = parseWorkspace({ manifest, items: { l2: { ...l2, blocks: [] } } });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ docId: 'l2', path: '/blocks' });
    expect(r.parsed!.invalidItemIds).toEqual(['l2']);
  });
  it('rejects non-item kinds placed in items', () => {
    const r = parseWorkspace({ manifest, items: { l2: { schemaVersion: 1, kind: 'resource', id: 'l2', title: 't', summary: 's', resourceType: 'guide', body: { blocks: [p('x')] } } } });
    expect(r.diagnostics[0]).toMatchObject({ code: 'E_ITEM_KIND_MISMATCH', docId: 'l2' });
    expect(r.parsed!.invalidItemIds).toEqual(['l2']);
  });
  it('splits inline items into documents and stubs, and re-inlines losslessly', () => {
    const split = splitInlineCourse(CourseDocumentSchema.parse(manifest));
    expect(split.manifest.modules[0].items[0]).toEqual({ type: 'lesson', id: 'l1', title: 'Inline lesson' });
    expect(split.items.l1).toMatchObject({ kind: 'lesson', id: 'l1', blocks: [p('a')] });
    expect(split.items.e1).toMatchObject({ kind: 'exam', id: 'e1' });
    const merged = inlineWorkspace({ manifest: split.manifest, items: { ...split.items, l2: l2 as never }, invalidItemIds: [] });
    expect((merged.modules[0].items[0] as { blocks: unknown[] }).blocks).toEqual([p('a')]);
    expect((merged.modules[0].items[1] as { blocks: unknown[] }).blocks).toEqual([p('b')]);
  });
  it('builds a workspace from a list of raw documents', () => {
    const ws = workspaceFromDocuments([l2, manifest]);
    expect((ws.manifest as CourseDocument).id).toBe('c');
    expect(Object.keys(ws.items)).toEqual(['l2']);
  });
  it('keeps a "__proto__" id off the prototype', () => {
    const doc = { schemaVersion: 1, kind: 'lesson', id: '__proto__', title: 'x', blocks: [p('x')] };
    const ws = workspaceFromDocuments([doc]);
    expect(Object.keys(ws.items)).toEqual(['__proto__']);
    expect(ws.items.__proto__).toBe(doc);
  });
});

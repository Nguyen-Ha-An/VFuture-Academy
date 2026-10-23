import { describe, expect, it } from 'vitest';

import course from '@/content-engine/fixtures/minimal/course.json';
import lesson from '@/content-engine/fixtures/minimal/items/intro.json';
import { COURSE_REF, itemRef, refKey } from '@/content-engine/diagnostics';
import { CourseDocumentSchema } from '@/content-engine/schema/course';
import { splitInlineCourse } from '@/content-engine/validate/workspace';
import {
  COURSE_SOURCE_KEY, acceptWorkspaceSave, canonicalSource, changeWorkspaceManifest, changeWorkspaceSource,
  createSourceIdentityCache, createWorkspaceState, importWorkspaceItemLocally, itemSourceKey, materializeWorkspaceItem,
  mutationFailureOf, restoreWorkspaceSources, sourceDiagnostics, workspaceIsDirty, workspacePayload,
  workspaceStructureDiagnostics,
} from '@/features/studio/workspace-state';

const split = splitInlineCourse(CourseDocumentSchema.parse(course));
const draft = {
  id: 'draft', courseId: 'minimal', manifest: split.manifest, items: { ...split.items, intro: lesson },
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-06T00:00:00Z',
};
const introKey = itemSourceKey('intro');
const codes = (state: Parameters<typeof workspacePayload>[0], ref = COURSE_REF) => sourceDiagnostics(state, ref).map(d => d.code);

describe('raw sources are authoritative', () => {
  it('preserves raw formatting without rebuilding parsed state for a validated semantic no-op', () => {
    const state = createWorkspaceState(draft);
    const source = `${state.sources.course} `;

    const next = changeWorkspaceSource(state, COURSE_REF, source);

    expect(next.sources.course).toBe(source);
    expect(next.manifest).toBe(state.manifest);
    expect(next.items).toBe(state.items);
    expect(next.mutation).toBeNull();
  });

  it('never treats whitespace inserted inside JSON tokens as formatting-only', () => {
    const cache = createSourceIdentityCache(8);
    const cases = [
      { manifest: { ...draft.manifest as object, estimatedMinutes: 12 }, token: '"estimatedMinutes": 12', malformed: '"estimatedMinutes": 1 2' },
      { manifest: { ...draft.manifest as object, completion: { rules: [{ type: 'all_items' }], certificate: true } }, token: '"certificate": true', malformed: '"certificate": tr ue' },
      { manifest: { ...draft.manifest as object, completion: { rules: [{ type: 'quiz_min_score', lessonId: 'intro', quizId: 'quiz-1', percent: 1.2 }] } }, token: '"percent": 1.2', malformed: '"percent": 1 .2' },
    ];

    for (const testCase of cases) {
      const state = createWorkspaceState({ ...draft, manifest: testCase.manifest });
      workspaceIsDirty(state, cache);
      const malformed = state.sources.course.replace(testCase.token, testCase.malformed);
      const next = changeWorkspaceSource(state, COURSE_REF, malformed, cache);
      expect(next.sources.course).toBe(malformed);
      expect(sourceDiagnostics(next, COURSE_REF).length).toBeGreaterThan(0);
      expect(workspaceIsDirty(next, cache)).toBe(true);
      expect(workspacePayload(next)).toBeNull();
    }
  });

  it('reuses bounded source identities for dirty checks without hiding invalid text', () => {
    const cache = createSourceIdentityCache(4);
    const state = createWorkspaceState(draft);
    expect(workspaceIsDirty(state, cache)).toBe(false);
    const afterInitial = cache.stats();
    expect(afterInitial.misses).toBe(Object.keys(state.sources).length);
    expect(afterInitial.hits).toBe(Object.keys(state.sources).length);
    expect(afterInitial.serializations).toBe(Object.keys(state.sources).length);

    expect(workspaceIsDirty(state, cache)).toBe(false);
    expect(cache.stats().serializations).toBe(afterInitial.serializations);

    const invalid = changeWorkspaceSource(state, COURSE_REF, '{broken', cache);
    expect(workspaceIsDirty(invalid, cache)).toBe(true);
    expect(cache.stats().size).toBeLessThanOrEqual(4);
  });

  it('keys the manifest and items so an item named `manifest` cannot displace the course', () => {
    expect(COURSE_SOURCE_KEY).toBe('course');
    expect(itemSourceKey('manifest')).toBe('item:manifest');
    expect(refKey(itemRef('manifest'))).not.toBe(COURSE_SOURCE_KEY);
  });

  it('holds an item legitimately named `manifest` alongside the course manifest', () => {
    const manifest = structuredClone(split.manifest);
    manifest.modules[0].items.push({ type: 'lesson', id: 'manifest' } as never);
    const state = createWorkspaceState({ ...draft, manifest, items: { ...draft.items, manifest: { ...lesson, id: 'manifest' } } });

    expect(Object.keys(state.sources).sort()).toEqual(['course', 'item:hello', 'item:intro', 'item:manifest']);
    expect(JSON.parse(state.sources['item:manifest']).id).toBe('manifest');
    expect(JSON.parse(state.sources.course).kind).toBe('course');
    expect(sourceDiagnostics(state, itemRef('manifest'))).toEqual([]);
    expect(sourceDiagnostics(state, COURSE_REF)).toEqual([]);
    expect(workspacePayload(state)).not.toBeNull();
  });

  it('ignores formatting but retains invalid text independently for every document', () => {
    let state = createWorkspaceState(draft);
    state = changeWorkspaceSource(state, itemRef('intro'), JSON.stringify(lesson));
    expect(workspaceIsDirty(state)).toBe(false);
    state = changeWorkspaceSource(state, itemRef('intro'), '{broken');
    state = changeWorkspaceSource(state, COURSE_REF, JSON.stringify({ ...split.manifest, title: 'Changed' }));
    expect(state.sources[introKey]).toBe('{broken');
    expect(workspaceIsDirty(state)).toBe(true);
    expect(workspacePayload(state)).toBeNull();
  });

  it('treats a duplicate key as an unsaved change even when the surviving value matches', () => {
    // JSON.parse keeps the last of two identical keys, so this text would
    // canonicalise to exactly the stored document. It must still read as dirty:
    // the author's text is rejected and has to stay recoverable.
    const state = createWorkspaceState(draft);
    const raw = state.sources.course.replace('"kind": "course"', '"title": "Ignored",\n  "kind": "course"');
    const next = changeWorkspaceSource(state, COURSE_REF, raw);

    expect(codes(next)).toContain('E_JSON_DUPLICATE_KEY');
    expect(next.sources.course).toBe(raw);
    expect(workspaceIsDirty(next)).toBe(true);
    expect(workspacePayload(next)).toBeNull();
  });

  it('gives rejected text no canonical form, so it never compares equal to a stored document', () => {
    const valid = createWorkspaceState(draft).sources.course;
    const duplicated = valid.replace('"kind": "course"', '"title": "Minimal course",\n  "kind": "course"');
    expect(canonicalSource(duplicated)).not.toBe(canonicalSource(valid));
    expect(canonicalSource('{broken')).not.toBe(canonicalSource('{}'));
    expect(canonicalSource(valid)).toBe(canonicalSource(JSON.stringify(JSON.parse(valid))));
  });
});

describe('structural mutations', () => {
  it('updates document title and manifest together through the tree', () => {
    const state = createWorkspaceState(draft);
    const manifest = structuredClone(split.manifest);
    manifest.modules[0].items[0].title = 'Renamed';
    const next = changeWorkspaceManifest(state, manifest);
    expect((next.items.intro as { title: string }).title).toBe('Renamed');
    expect(JSON.parse(next.sources[introKey]).title).toBe('Renamed');
    expect(workspaceIsDirty(next)).toBe(true);
  });

  it('refuses a tree change that would erase invalid source, and says why', () => {
    const state = changeWorkspaceSource(createWorkspaceState(draft), itemRef('intro'), '{broken');
    const manifest = structuredClone(split.manifest);
    manifest.modules[0].items[0].title = 'Renamed';
    try {
      changeWorkspaceManifest(state, manifest);
      throw new Error('expected the mutation to be refused');
    } catch (cause) {
      expect(mutationFailureOf(cause)).toEqual({ code: 'INVALID_SOURCE', ref: itemRef('intro') });
    }
    expect(state.sources[introKey]).toBe('{broken');
  });

  it('reports a refused manifest mutation on the state instead of swallowing it', () => {
    const state = changeWorkspaceSource(createWorkspaceState(draft), itemRef('intro'), '{broken');
    const manifest = structuredClone(split.manifest);
    manifest.modules[0].items[0].title = 'Renamed';

    const next = changeWorkspaceSource(state, COURSE_REF, JSON.stringify(manifest));

    expect(next.mutation).toEqual({ code: 'INVALID_SOURCE', ref: itemRef('intro') });
    expect(next.sources.course).toBe(JSON.stringify(manifest));
    expect(next.sources[introKey]).toBe('{broken');
  });

  it('refuses to rename the course through the manifest', () => {
    const state = createWorkspaceState(draft);
    const renamed = { ...split.manifest, id: 'somewhere-else' };
    expect(mutationFailureOf(
      (() => { try { changeWorkspaceManifest(state, renamed); } catch (cause) { return cause; } })(),
    )).toEqual({ code: 'IMMUTABLE_ID', ref: COURSE_REF });
  });

  it('refuses changing existing item identity or kind', () => {
    const state = changeWorkspaceSource(createWorkspaceState(draft), itemRef('intro'), JSON.stringify({ ...lesson, id: 'different' }));
    expect(codes(state, itemRef('intro'))).toEqual(['E_SCHEMA']);
    expect(workspacePayload(state)).toBeNull();
    expect(state.items.intro).toEqual(lesson);
  });
});

describe('targeted item import', () => {
  const imported = { ...lesson, id: 'second', title: 'Second lesson' };

  it('keeps every unrelated raw source byte-identical, including invalid text', () => {
    let state = createWorkspaceState(draft);
    const broken = '{ "kind": "lesson", "id": "intro"';
    state = changeWorkspaceSource(state, itemRef('intro'), broken);

    const next = importWorkspaceItemLocally(state, imported, 'm1');

    expect(next.sources[introKey]).toBe(broken);
    expect(next.sources[itemSourceKey('hello')]).toBe(state.sources[itemSourceKey('hello')]);
    expect(JSON.parse(next.sources[itemSourceKey('second')]).id).toBe('second');
    expect(JSON.parse(next.sources.course).modules[0].items.map((item: { id: string }) => item.id)).toEqual(['intro', 'hello', 'second']);
  });

  it('refuses to rewrite a manifest the author has left invalid', () => {
    const state = changeWorkspaceSource(createWorkspaceState(draft), COURSE_REF, '{ "kind": "course"');
    expect(mutationFailureOf(
      (() => { try { importWorkspaceItemLocally(state, imported, 'm1'); } catch (cause) { return cause; } })(),
    )).toEqual({ code: 'INVALID_MANIFEST', ref: COURSE_REF });
  });

  it('refuses an import that would change an existing item kind', () => {
    const state = createWorkspaceState(draft);
    expect(mutationFailureOf(
      (() => { try { importWorkspaceItemLocally(state, { ...lesson, id: 'hello' }, 'm1'); } catch (cause) { return cause; } })(),
    )).toEqual({ code: 'IMMUTABLE_ID', ref: itemRef('hello') });
  });

  it('replaces a declared item in place without moving it', () => {
    const state = createWorkspaceState(draft);
    const next = importWorkspaceItemLocally(state, { ...lesson, title: 'Replaced' }, 'm1');
    const ids = JSON.parse(next.sources.course).modules[0].items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(['intro', 'hello']);
    expect(JSON.parse(next.sources[introKey]).title).toBe('Replaced');
  });

  it('refuses an item aimed at a module that does not exist', () => {
    const state = createWorkspaceState(draft);
    expect(mutationFailureOf(
      (() => { try { importWorkspaceItemLocally(state, imported, 'no-such-module'); } catch (cause) { return cause; } })(),
    )).toEqual({ code: 'UNKNOWN_ITEM', ref: itemRef('second') });
  });
});

describe('incomplete drafts', () => {
  it('does not invent documents the manifest declares but that were never stored', () => {
    const state = createWorkspaceState({ ...draft, items: {} });

    expect(state.items.intro).toBeUndefined();
    expect(Object.keys(state.sources)).toEqual(['course']);
    expect(workspaceIsDirty(state)).toBe(false);
    expect(workspacePayload(state)).toBeNull();
    expect(workspaceStructureDiagnostics(state).map(d => [d.code, d.docId]))
      .toEqual([['E_MISSING_ITEM_DOCUMENT', 'intro'], ['E_MISSING_ITEM_DOCUMENT', 'hello']]);
  });

  it('scaffolds a starter document only on an explicit author action', () => {
    const state = createWorkspaceState({ ...draft, items: {} });
    const next = materializeWorkspaceItem(state, 'intro');
    expect(JSON.parse(next.sources[introKey])).toMatchObject({ id: 'intro', kind: 'lesson' });
    expect(workspaceIsDirty(next)).toBe(true);
  });

  it('reports an item document the manifest does not declare', () => {
    const state = createWorkspaceState({ ...draft, items: { ...draft.items, stray: { ...lesson, id: 'stray' } } });
    expect(workspaceStructureDiagnostics(state).map(d => [d.code, d.docId])).toEqual([['W_ORPHAN_ITEM_DOCUMENT', 'stray']]);
    expect(workspacePayload(state)).toBeNull();
  });
});

describe('saving', () => {
  it('keeps edits made during a save dirty and uses the returned revision', () => {
    let state = changeWorkspaceSource(createWorkspaceState(draft), itemRef('intro'), JSON.stringify({ ...lesson, title: 'Saved title' }));
    const sent = workspacePayload(state)!;
    state = changeWorkspaceSource(state, itemRef('intro'), JSON.stringify({ ...lesson, title: 'Newer title' }));

    const next = acceptWorkspaceSave(state, { ...draft, ...sent, updatedAt: '2026-09-06T00:01:00Z' });

    expect(next.updatedAt).toBe('2026-09-06T00:01:00Z');
    expect(JSON.parse(next.sources[introKey]).title).toBe('Newer title');
    expect(workspaceIsDirty(next)).toBe(true);
  });

  it('refuses to build a payload while any document is missing or orphaned', () => {
    const state = createWorkspaceState({ ...draft, items: { intro: lesson } });
    expect(workspacePayload(state)).toBeNull();
  });
});

describe('restoring raw sources', () => {
  it('takes the text verbatim and keeps invalid documents legible', () => {
    const state = createWorkspaceState(draft);
    const restored = restoreWorkspaceSources(state, {
      ...state.sources,
      [introKey]: '{ "kind": "lesson", "id": "intro"',
    });

    expect(restored.sources[introKey]).toBe('{ "kind": "lesson", "id": "intro"');
    expect(codes(restored, itemRef('intro'))).toEqual(['E_JSON_PARSE']);
    expect(workspaceIsDirty(restored)).toBe(true);
    expect(workspacePayload(restored)).toBeNull();
  });

  it('restores a valid set of sources into a saveable workspace', () => {
    const state = createWorkspaceState(draft);
    const edited = { ...state.sources, [introKey]: JSON.stringify({ ...lesson, title: 'Restored' }, null, 2) };
    const restored = restoreWorkspaceSources(state, edited);

    expect(workspacePayload(restored)).not.toBeNull();
    expect((workspacePayload(restored)!.items.intro as { title: string }).title).toBe('Restored');
  });
});

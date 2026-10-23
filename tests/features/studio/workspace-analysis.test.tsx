// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { COURSE_REF } from '@/content-engine/diagnostics';
import { sourcesRevision } from '@/content-engine/validate/revision';
import { FIXTURES } from '@/content-engine/fixtures';
import { changeWorkspaceSource, createWorkspaceState } from '@/features/studio/workspace-state';
import { analyzeWorkspaceState, createWorkspaceAnalysisCache, useWorkspaceAnalysis } from '@/features/studio/ui/useWorkspaceAnalysis';

const draft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items,
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('analyzes the save payload and diagnostics together', () => {
  const valid = createWorkspaceState(draft);
  expect(analyzeWorkspaceState(valid)).toMatchObject({ payload: { manifest: valid.manifest, items: valid.items }, diagnostics: [] });

  const invalid = changeWorkspaceSource(valid, COURSE_REF, '{broken');
  const analyzed = analyzeWorkspaceState(invalid);
  expect(analyzed.payload).toBeNull();
  expect(analyzed.diagnostics[0]?.severity).toBe('error');
});

it('reuses unchanged document parse/schema work after one document changes', () => {
  const cache = createWorkspaceAnalysisCache(16);
  const initial = createWorkspaceState(draft);
  analyzeWorkspaceState(initial, cache);
  expect(cache.stats()).toMatchObject({ misses: 3, hits: 0, size: 3 });

  const changed = changeWorkspaceSource(initial, COURSE_REF, JSON.stringify({ ...(initial.manifest as Record<string, unknown>), title: 'Only manifest changed' }));
  analyzeWorkspaceState(changed, cache);

  expect(cache.stats()).toMatchObject({ misses: 4, hits: 2, size: 4 });
});

it('invalidates cached diagnostics when course identity or expected item kind changes', () => {
  const cache = createWorkspaceAnalysisCache(8);
  const initial = createWorkspaceState(draft);
  analyzeWorkspaceState(initial, cache);
  const afterInitial = cache.stats().misses;

  const otherCourse = { ...initial, courseId: 'different-course' };
  expect(analyzeWorkspaceState(otherCourse, cache).diagnostics.some(issue => issue.path === '/id')).toBe(true);
  expect(cache.stats().misses).toBe(afterInitial + 1);

  const changedKind = structuredClone(initial);
  changedKind.items.intro = { ...(changedKind.items.intro as Record<string, unknown>), kind: 'assignment' };
  expect(analyzeWorkspaceState(changedKind, cache).payload).toBeNull();
  expect(cache.stats().misses).toBe(afterInitial + 2);
});

it('bounds retained per-document analysis entries', () => {
  const cache = createWorkspaceAnalysisCache(2);
  const initial = createWorkspaceState(draft);
  analyzeWorkspaceState(initial, cache);
  expect(cache.stats().size).toBe(2);
});

it('keeps cross-document completeness and ID checks fresh across cache hits', () => {
  const cache = createWorkspaceAnalysisCache(16);
  const initial = createWorkspaceState(draft);
  analyzeWorkspaceState(initial, cache);
  const missing = { ...initial, sources: { ...initial.sources } };
  delete missing.sources['item:intro'];

  const missingAnalysis = analyzeWorkspaceState(missing, cache);
  expect(missingAnalysis.payload).toBeNull();
  expect(missingAnalysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'E_MISSING_ITEM_DOCUMENT', docId: 'intro' }));

  const manifest = structuredClone(initial.manifest) as { modules: Array<{ items: Array<Record<string, unknown>> }> };
  manifest.modules[0]!.items[1] = { ...manifest.modules[0]!.items[1], id: 'intro' };
  const duplicate = changeWorkspaceSource(initial, COURSE_REF, JSON.stringify(manifest));
  const duplicateAnalysis = analyzeWorkspaceState(duplicate, cache);
  expect(duplicateAnalysis.payload).toBeNull();
  expect(duplicateAnalysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'E_DUPLICATE_ID' }));
});

it('shares cached parsed values as immutable objects', () => {
  const cache = createWorkspaceAnalysisCache(8);
  const initial = createWorkspaceState(draft);
  const first = analyzeWorkspaceState(initial, cache);
  const second = analyzeWorkspaceState(initial, cache);
  expect(second.payload?.manifest).toBe(first.payload?.manifest);
  expect(Object.isFrozen(second.payload?.manifest)).toBe(true);
});

it('debounces worker analysis and ignores stale worker responses', async () => {
  vi.useFakeTimers();
  const workers: FakeWorker[] = [];
  const workerUrls: string[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    posted: Array<{ id: number; revision: string; state: ReturnType<typeof createWorkspaceState> }> = [];
    constructor(url: string | URL) { workers.push(this); workerUrls.push(String(url)); }
    postMessage(value: { id: number; revision: string; state: ReturnType<typeof createWorkspaceState> }) { this.posted.push(value); }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const initial = createWorkspaceState(draft);
  const changed = changeWorkspaceSource(initial, COURSE_REF, JSON.stringify({ ...(draft.manifest as Record<string, unknown>), title: 'Changed' }));
  const changedAgain = changeWorkspaceSource(changed, COURSE_REF, JSON.stringify({ ...(draft.manifest as Record<string, unknown>), title: 'Changed again' }));
  const { result, rerender } = renderHook(({ state }) => useWorkspaceAnalysis(state), { initialProps: { state: initial } });
  expect(workerUrls).toEqual(['/studio-workers/workspace-analysis.js']);

  rerender({ state: changed });
  await act(async () => { await vi.advanceTimersByTimeAsync(199); });
  expect(workers[0]?.posted).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(workers[0]?.posted).toHaveLength(1);
  const first = workers[0]!.posted[0]!;

  rerender({ state: changedAgain });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  const second = workers[0]!.posted[1]!;
  act(() => workers[0]!.onmessage?.({ data: { id: first.id, revision: sourcesRevision(changed.sources), analysis: analyzeWorkspaceState(changed) } } as MessageEvent));
  expect(result.current.revision).not.toBe(sourcesRevision(changed.sources));

  act(() => workers[0]!.onmessage?.({ data: { id: second.id, revision: second.revision, analysis: analyzeWorkspaceState(changedAgain) } } as MessageEvent));
  expect(result.current.revision).toBe(sourcesRevision(changedAgain.sources));
});

// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { COURSE_REF } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import { useWorkspaceDraft } from '@/features/studio/ui/useWorkspaceDraft';

const draft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items,
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
};
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
const title = (source: string, value: string) => source.replace(/"title": "[^"]+"/, `"title": "${value}"`);

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('does not allow navigation if sources change while the flushed save is pending', async () => {
  let release!: () => void;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    await new Promise<void>(resolve => { release = resolve; });
    return ok({ ...draft, ...body, updatedAt: '2026-09-05T07:01:00.000Z' });
  });
  const { result } = renderHook(() => useWorkspaceDraft(draft, false, { fetcher }));
  const original = result.current.state.sources.course;
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Save boundary')));
  let flushed!: Promise<boolean>;
  act(() => { flushed = result.current.flush(); });
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Changed during save')));
  await act(async () => { release(); });
  await expect(flushed).resolves.toBe(false);
  expect(result.current.dirty).toBe(true);
});

it('waits for an older save then flushes the exact sources captured at review click', async () => {
  let release!: () => void;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (fetcher.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return ok({ ...draft, ...body, updatedAt: `2026-09-05T07:0${fetcher.mock.calls.length}:00.000Z` });
  });
  const { result } = renderHook(() => useWorkspaceDraft(draft, false, { fetcher }));
  const original = result.current.state.sources.course;
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Older autosave')));
  let older!: Promise<boolean>;
  act(() => { older = result.current.save(); });
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Review click snapshot')));

  let flushed!: Promise<boolean>;
  act(() => { flushed = result.current.flush(); });
  await act(async () => { release(); await older; });

  await expect(flushed).resolves.toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).manifest.title).toBe('Review click snapshot');
});

it('refuses the flush when the author types after review click', async () => {
  let release!: () => void;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    await new Promise<void>(resolve => { release = resolve; });
    return ok({ ...draft, ...body, updatedAt: '2026-09-05T07:01:00.000Z' });
  });
  const { result } = renderHook(() => useWorkspaceDraft(draft, false, { fetcher }));
  const original = result.current.state.sources.course;
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Older autosave')));
  act(() => { void result.current.save(); });
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Review click snapshot')));
  let flushed!: Promise<boolean>;
  act(() => { flushed = result.current.flush(); });
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Typed after click')));
  act(() => result.current.changeSource(COURSE_REF, title(original, 'Review click snapshot')));

  await act(async () => { release(); });

  await expect(flushed).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});

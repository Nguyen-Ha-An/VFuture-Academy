// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, onChange }: { source: string; docRef: { kind: string; id?: string }; onChange: (source: string) => void }) =>
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => null }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items,
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
};
const report: ValidationReport = {
  ok: true, errors: [], warnings: [],
  summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] },
};
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
const savedResponse = (init?: RequestInit, updatedAt = '2026-09-05T07:01:00.000Z') => {
  const body = JSON.parse(String(init?.body));
  return ok({ ...draft, ...body, updatedAt });
};
const open = () => render(<NextIntlClientProvider locale="en" messages={messages}>
  <Workspace initialDraft={draft} initialReport={report} recoveryClaim={() => Promise.reject(new Error('none'))} workflowEnabled={false} />
</NextIntlClientProvider>);
const editTitle = (title: string) => {
  const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
  fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace(/"title": "[^"]+"/, `"title": "${title}"`) } });
  return editor;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('course workspace autosave', () => {
  it('debounces a valid dirty snapshot for 1500ms', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => savedResponse(init));
    vi.stubGlobal('fetch', fetcher);
    open();
    editTitle('Autosaved');

    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).manifest.title).toBe('Autosaved');
  });

  it('never autosaves invalid source', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'JSON editor for manifest' }), { target: { value: '{broken' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('starts Ctrl+S immediately instead of waiting for the debounce', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => savedResponse(init));
    vi.stubGlobal('fetch', fetcher);
    open();
    editTitle('Keyboard save');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await act(async () => { await Promise.resolve(); });

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('queues edits made during a request for the next debounce without overlapping writes', async () => {
    vi.useFakeTimers();
    let releaseFirst!: () => void;
    let active = 0;
    let maxActive = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (fetcher.mock.calls.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      active -= 1;
      return savedResponse(init, `2026-09-05T07:0${fetcher.mock.calls.length}:00.000Z`);
    });
    vi.stubGlobal('fetch', fetcher);
    open();
    editTitle('First edit');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetcher).toHaveBeenCalledOnce();

    editTitle('Second edit');
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => { releaseFirst(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).manifest.title).toBe('Second edit');
  });

  it('latches autosave off after an error until the author explicitly retries', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'No' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => savedResponse(init));
    vi.stubGlobal('fetch', fetcher);
    open();
    editTitle('First failure');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    editTitle('Still local');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows a persistent acknowledgment time and stops calling newer edits saved', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:11:12'));
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => savedResponse(init));
    vi.stubGlobal('fetch', fetcher);
    open();
    editTitle('Saved once');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(/Saved.*10:11:12/);

    editTitle('New unsaved edit');

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');
    expect(screen.getAllByRole('status')[0]).not.toHaveTextContent(/Saved.*10:11:12/);
  });
});

// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { COURSE_REF, itemRef } from '@/content-engine/diagnostics';
import { PreviewPane, type WorkspacePreview } from '@/features/studio/ui/PreviewPane';

vi.mock('@/content-engine/render', () => ({
  registerAll: () => undefined,
  createPreviewRuntime: () => ({}),
  LessonRenderer: ({ item }: { item: { title: string } }) => <h3>{item.title}</h3>,
  ExamPreviewRenderer: () => null,
  AssignmentRenderer: () => null,
}));
const report = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 0 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };
const result = (id: string, title: string): WorkspacePreview => ({ report, course: null, item: { id, kind: 'lesson', checksum: title, renders: { en: { id, kind: 'lesson', title }, vi: { id, kind: 'lesson', title } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } } });
const response = (id: string, title: string) => new Response(JSON.stringify({ data: result(id, title) }), { status: 200 });
const payload = { manifest: { id: 'course' }, items: {} };
const onReport = vi.fn();
function view(selectedDocId = 'one', sourceRevision = '1', valid = true) {
  const selectedRef = selectedDocId === 'manifest' ? COURSE_REF : itemRef(selectedDocId);
  return <NextIntlClientProvider locale="en" messages={messages}><PreviewPane courseId="course" selectedRef={selectedRef} payload={valid ? payload : null} sourceRevision={sourceRevision} languages={['en']} defaultLanguage="en" onReport={onReport} /></NextIntlClientProvider>;
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('unsaved preview', () => {
  it('requests a newly selected document immediately and reuses unchanged cached previews', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response('one', 'First')).mockResolvedValueOnce(response('two', 'Second'));
    vi.stubGlobal('fetch', fetcher);
    const rendered = render(view());
    await act(() => vi.advanceTimersByTimeAsync(400));
    rendered.rerender(view('two'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Second')).toBeDefined();
    rendered.rerender(view('one'));
    expect(screen.getByText('First')).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('debounces preview and never sends a save request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response('one', 'Unsaved title'));
    vi.stubGlobal('fetch', fetcher);
    const rendered = render(view());
    await act(() => vi.advanceTimersByTimeAsync(200));
    rendered.rerender(view('one', '2'));
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(fetcher).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/studio/courses/course/draft/preview');
    expect(screen.getByText('Unsaved title')).toBeDefined();
  });
  it('retains the previous valid preview on malformed JSON without leaking another item', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response('one', 'Valid one'));
    vi.stubGlobal('fetch', fetcher);
    const rendered = render(view());
    await act(() => vi.advanceTimersByTimeAsync(400));
    rendered.rerender(view('one', 'broken', false));
    expect(screen.getByText('Valid one')).toBeDefined();
    expect(screen.getByText('Showing the last valid preview.')).toBeDefined();
    rendered.rerender(view('two', 'broken', false));
    expect(screen.queryByText('Valid one')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('ignores a response that arrives after switching documents', async () => {
    vi.useFakeTimers();
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response('two', 'Current two'));
    vi.stubGlobal('fetch', fetcher);
    const rendered = render(view());
    await act(() => vi.advanceTimersByTimeAsync(400));
    rendered.rerender(view('two', '2'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(async () => resolveOld(response('one', 'Late old one')));
    expect(screen.getByText('Current two')).toBeDefined();
    expect(screen.queryByText('Late old one')).toBeNull();
    expect((fetcher.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  });
  it('reports structured preview validation failures to the diagnostics owner', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'INVALID_WORKSPACE',
      message: 'Workspace cannot be previewed',
      issues: [{ path: ['items', 'first-lesson'], message: 'Manifest item has no matching document' }],
    } }), { status: 422, headers: { 'content-type': 'application/json' } })));

    render(view());
    await act(() => vi.advanceTimersByTimeAsync(400));

    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      errors: [expect.objectContaining({ docId: 'first-lesson', message: expect.objectContaining({ en: 'Manifest item has no matching document' }) })],
    }), '1');
  });
});

describe('document identity on the wire', () => {
  it('sends the authoritative reference so an item named `manifest` is not read as the course', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response('manifest', 'Item called manifest'));
    vi.stubGlobal('fetch', fetcher);

    render(<NextIntlClientProvider locale="en" messages={messages}><PreviewPane courseId="course" selectedRef={itemRef('manifest')} payload={payload} sourceRevision="1" languages={['en']} defaultLanguage="en" onReport={onReport} /></NextIntlClientProvider>);
    await act(() => vi.advanceTimersByTimeAsync(400));

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.selectedRef).toEqual({ kind: 'item', id: 'manifest' });
    // The legacy field stays for compatibility, and is exactly why `selectedRef` is needed.
    expect(body.selectedDocId).toBe('manifest');
    expect(screen.getByText('Item called manifest')).toBeDefined();
  });

  it('sends the course reference for the manifest itself', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response('one', 'First'));
    vi.stubGlobal('fetch', fetcher);

    render(view('manifest-course-marker'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).selectedRef).toEqual({ kind: 'item', id: 'manifest-course-marker' });

    cleanup();
    fetcher.mockClear();
    render(<NextIntlClientProvider locale="en" messages={messages}><PreviewPane courseId="course" selectedRef={COURSE_REF} payload={payload} sourceRevision="1" languages={['en']} defaultLanguage="en" onReport={onReport} /></NextIntlClientProvider>);
    await act(() => vi.advanceTimersByTimeAsync(400));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.selectedRef).toEqual({ kind: 'course' });
    expect(body.selectedDocId).toBe('manifest');
  });
});

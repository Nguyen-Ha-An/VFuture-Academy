// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, onChange }: { source: string; docRef: { kind: string; id?: string }; onChange: (source: string) => void }) => <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => null }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const revision = '2026-09-05T07:00:00.000Z';
const draft: WorkspaceDraft = { id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, baseVersionId: null, checklist: {}, updatedAt: revision };
const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
const renderWorkspace = () => render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} workflowEnabled={false} /></NextIntlClientProvider>);

afterEach(() => { cleanup(); mocks.router.push.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Workspace manual save', () => {
  it('saves edits from multiple documents in one full snapshot with the draft revision', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return ok({ ...draft, ...body, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();
    const manifestEditor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    fireEvent.change(manifestEditor, { target: { value: String((manifestEditor as HTMLTextAreaElement).value).replace('Minimal course', 'Edited course') } });
    fireEvent.click(screen.getByText('Welcome').closest('button')!);
    const itemEditor = screen.getByRole('textbox', { name: 'JSON editor for intro' });
    fireEvent.change(itemEditor, { target: { value: String((itemEditor as HTMLTextAreaElement).value).replace('Welcome', 'Edited lesson') } });

    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/v1/studio/courses/minimal/draft/workspace');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('if-match')).toBe(revision);
    const body = JSON.parse(String(init?.body));
    expect(body.manifest.title).toBe('Edited course');
    expect(body.items.intro.title).toBe('Edited lesson');
    expect(body.items.hello).toMatchObject({ id: 'hello', kind: 'assignment' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  it('retains failed edits and allows an explicit retry', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'No' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => ok({ ...draft, ...JSON.parse(String(init?.body)), updatedAt: '2026-09-05T07:01:00.000Z' }));
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    const edited = String((editor as HTMLTextAreaElement).value).replace('Minimal course', 'Kept after failure');
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your edits are retained');
    expect(editor).toHaveValue(edited);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled());
  });

  it('shows the server validation issue when a save is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'INVALID_WORKSPACE',
      message: 'Workspace cannot be saved',
      issues: [{ path: ['items', 'intro'], message: 'Manifest item has no matching document' }],
    } }), { status: 422, headers: { 'content-type': 'application/json' } })));
    renderWorkspace();
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace('Minimal course', 'Rejected course') } });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Manifest item has no matching document');
  });

  it('keeps conflict edits until the user explicitly loads the server version', async () => {
    const remote = { ...draft, manifest: { ...(FIXTURES.minimal.manifest as Record<string, unknown>), title: 'Server course' }, updatedAt: '2026-09-05T07:02:00.000Z' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'DRAFT_CONFLICT', message: 'Conflict' } }), { status: 412, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(ok(remote));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:edits');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    renderWorkspace();
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    const local = String((editor as HTMLTextAreaElement).value).replace('Minimal course', 'Local course');
    fireEvent.change(editor, { target: { value: local } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Download your changes');
    expect(editor).toHaveValue(local);
    fireEvent.click(screen.getByRole('button', { name: 'Download edits' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Load server version' }));

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('Server course'));
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/v1/studio/courses/minimal/draft');
  });
});

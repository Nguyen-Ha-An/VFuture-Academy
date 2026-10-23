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
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => <div aria-label="Preview pane" /> }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = { id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: {}, baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z' };
const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 0, questions: {}, totalPoints: 0, languages: ['en'] } };
const renderWorkspace = () => render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} workflowEnabled={false} /></NextIntlClientProvider>);

afterEach(() => { cleanup(); mocks.router.push.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Workspace missing documents', () => {
  it('does not invent a document for a declared item, and offers to scaffold one explicitly', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: /Untitled item.*Stub without document/ }));

    // Nothing was created on the author's behalf.
    expect(screen.getByText(/declared in the outline but has no document/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'JSON editor for intro' })).toHaveValue('');
    expect(fetcher).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create a starter document' }));

    expect((screen.getByRole('textbox', { name: 'JSON editor for intro' }) as HTMLTextAreaElement).value).toContain('"id": "intro"');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('leaves an incomplete draft clean and unsaveable until the author acts', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();

    // No hydration means no phantom unsaved changes on open.
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(/^Saved · \d{2}:\d{2}:\d{2}$/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not autosave before the debounce and manual Save persists immediately', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({ data: {
      ...draft, manifest: JSON.parse(String(init?.body)).manifest, items: JSON.parse(String(init?.body)).items,
      updatedAt: '2026-09-05T07:01:00.000Z',
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /Untitled item.*Stub without document/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create a starter document' }));
    const editor = screen.getByRole('textbox', { name: 'JSON editor for intro' });
    fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace('"title": "intro"', '"title": "Local lesson"') } });

    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/studio/courses/minimal/draft/workspace');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).items.intro).toMatchObject({ id: 'intro', title: 'Local lesson' });
  });
});

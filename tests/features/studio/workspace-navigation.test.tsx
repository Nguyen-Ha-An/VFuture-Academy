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

const draft: WorkspaceDraft = { id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z' };
const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };
const renderWorkspace = () => render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} workflowEnabled={false} /></NextIntlClientProvider>);

afterEach(() => { cleanup(); mocks.router.push.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Studio workspace navigation', () => {
  it('links back to the course list immediately when the draft is clean', () => {
    renderWorkspace();
    expect(screen.getByRole('link', { name: 'Course list' })).toHaveAttribute('href', '/studio/courses');
  });

  it('offers save and leave for dirty navigation and waits for the atomic save', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({ data: {
      ...draft, ...JSON.parse(String(init?.body)), updatedAt: '2026-09-05T07:01:00.000Z',
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace('Minimal course', 'Edited course') } });

    fireEvent.click(screen.getByRole('link', { name: 'Course list' }));
    expect(await screen.findByRole('dialog', { name: 'You have unsaved changes' })).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/studio/courses'));
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

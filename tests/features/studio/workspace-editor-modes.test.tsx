// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn() }, workflowLocked: false }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, readOnly, onChange }: { source: string; docRef: { kind: string; id?: string }; readOnly: boolean; onChange: (source: string) => void }) => (
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} readOnly={readOnly} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => <div aria-label="Preview pane" /> }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));
vi.mock('@/features/content-review/ContentWorkflowPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { ContentWorkflowPanel: ({ contentType, contentId, onLockChange, getExpectedRevision }: { contentType: string; contentId: string; onLockChange: (locked: boolean) => void; getExpectedRevision: () => string | null }) => {
    React.useEffect(() => onLockChange(mocks.workflowLocked), [onLockChange]);
    return <section aria-label="Content review workflow"><span>{contentType}:{contentId}:{getExpectedRevision()}</span><button type="button">Submit for review</button></section>;
  } };
});

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest,
  items: FIXTURES.minimal.items, baseVersionId: null, checklist: {},
  updatedAt: '2026-09-05T07:00:00.000Z',
};
const report: ValidationReport = {
  ok: true, errors: [], warnings: [],
  summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] },
};

function renderWorkspace() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} /></NextIntlClientProvider>);
}

afterEach(() => {
  cleanup();
  mocks.router.push.mockClear();
  mocks.workflowLocked = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('manual JSON workspace', () => {
  it('has one source editor and no forms or prompt mode', () => {
    renderWorkspace();

    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forms' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Advanced JSON' })).not.toBeInTheDocument();
    expect(screen.queryByText(/prompt/i)).not.toBeInTheDocument();
  });

  it('retains malformed source verbatim while selecting other documents', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();

    fireEvent.click(screen.getByText('Welcome').closest('button')!);
    fireEvent.change(screen.getByRole('textbox', { name: 'JSON editor for intro' }), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Course manifest' }));
    fireEvent.click(screen.getByText('Welcome').closest('button')!);

    expect(screen.getByRole('textbox', { name: 'JSON editor for intro' })).toHaveValue('{');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('blocks saving an existing document under a different id', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderWorkspace();
    fireEvent.click(screen.getByText('Welcome').closest('button')!);
    const editor = screen.getByRole('textbox', { name: 'JSON editor for intro' });
    fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace('"id": "intro"', '"id": "renamed"') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Some JSON or course structure is invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the shared review workflow and removes direct publishing from the editor', () => {
    renderWorkspace();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Content review workflow' })).toHaveTextContent('course:minimal:2026-09-05T07:00:00.000Z');
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('locks editing while the shared workflow reports a pending review', async () => {
    mocks.workflowLocked = true;
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveAttribute('readonly'));
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Diagnostic, ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import type { BeforeSubmitResult, ContentWorkflow } from '@/features/content-review/ContentWorkflowPanel';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  previewReport: null as ValidationReport | null,
  workflow: null as ContentWorkflow | null,
  beforeSubmit: null as null | (() => Promise<BeforeSubmitResult>),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, readOnly, onChange }: { source: string; docRef: { kind: string; id?: string }; readOnly: boolean; onChange: (source: string) => void }) => (
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} readOnly={readOnly} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}));
vi.mock('@/features/studio/ui/PreviewPane', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { PreviewPane: ({ sourceRevision, onReport }: { sourceRevision: string; onReport: (report: ValidationReport, revision: string) => void }) => {
    React.useEffect(() => { if (mocks.previewReport) onReport(mocks.previewReport, sourceRevision); }, [onReport, sourceRevision]);
    return <div aria-label="Preview pane" />;
  } };
});
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));
vi.mock('@/features/content-review/ContentWorkflowPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { ContentWorkflowPanel: ({ onLockChange, onWorkflowChange, beforeSubmit }: { onLockChange: (locked: boolean) => void; onWorkflowChange: (workflow: ContentWorkflow | null) => void; beforeSubmit: () => Promise<BeforeSubmitResult> }) => {
    mocks.beforeSubmit = beforeSubmit;
    React.useEffect(() => { onLockChange(false); onWorkflowChange(mocks.workflow); }, [onLockChange, onWorkflowChange]);
    return <section aria-label="Content review workflow" />;
  } };
});

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest,
  items: FIXTURES.minimal.items, baseVersionId: null, checklist: {},
  updatedAt: '2026-09-05T07:00:00.000Z',
};
const summary: ValidationReport['summary'] = { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] };
const clean: ValidationReport = { ok: true, errors: [], warnings: [], summary };
const diagnostic = (code: string, severity: Diagnostic['severity'], en: string): Diagnostic => ({ severity, code: code as Diagnostic['code'], docId: 'intro', path: '', message: { vi: en, en } });

function renderWorkspace() {
  return render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><Workspace initialDraft={draft} initialReport={clean} /></NextIntlClientProvider>);
}

afterEach(() => {
  cleanup();
  mocks.previewReport = null;
  mocks.workflow = null;
  mocks.beforeSubmit = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('course workspace header readiness', () => {
  it('leaves every automatic check unverified until the current revision has a report', async () => {
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Readiness 0/6' }));
    const sheet = await screen.findByRole('dialog', { name: 'Publish readiness' });
    expect(within(sheet).getAllByText('Waiting for the current revision to be checked.')).toHaveLength(5);
    expect(within(sheet).getByText('The reviewer confirms this when approving and publishing.')).toBeInTheDocument();
    expect(within(sheet).getByRole('region', { name: 'Diagnostics' })).toBeInTheDocument();
  });

  it('counts passing checks from the report for the text on screen and never ticks the manual one', async () => {
    mocks.previewReport = { ...clean, warnings: [diagnostic('W_NO_ALT_TEXT', 'warning', 'Image has empty alt text')] };
    renderWorkspace();

    const button = await screen.findByRole('button', { name: 'Readiness 3/6' });
    fireEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Publish readiness' });
    const accessibility = within(sheet).getByText('Accessibility').closest('li');
    expect(accessibility).toHaveAttribute('data-status', 'warn');
    expect(within(sheet).getByText('Age appropriate').closest('li')).toHaveAttribute('data-status', 'manual');
    expect(within(sheet).getByText('Learning outcomes').closest('li')).toHaveAttribute('data-status', 'pass');
  });

  it('shows the lifecycle stage from the workflow as a status badge', async () => {
    mocks.workflow = {
      content: { contentType: 'course', contentId: 'minimal', revisionKey: 'r1', status: 'draft', publishedRevisionKey: null },
      activeReview: { id: 'review-1', status: 'changes_requested', revisionKey: 'r1', note: null },
      publication: null,
      actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true },
    };
    renderWorkspace();

    expect(await screen.findByText('Changes requested')).toHaveAttribute('data-tone', 'danger');
  });

  it('returns the blocking validation errors to the workflow panel instead of "save first"', async () => {
    const report: ValidationReport = { ok: false, errors: [diagnostic('E_ANSWER_SHAPE', 'error', 'Answer key has the wrong shape: options')], warnings: [], summary };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: report }), { status: 200, headers: { 'content-type': 'application/json' } })));
    renderWorkspace();
    await waitFor(() => expect(mocks.beforeSubmit).not.toBeNull());

    let result: BeforeSubmitResult | undefined;
    await act(async () => { result = await mocks.beforeSubmit!(); });

    expect(result).toEqual({ ok: false, message: expect.stringContaining('Fix 1 error before submitting for review.') });
    expect((result as { message: string }).message).toContain('Answer key has the wrong shape: options');
  });
});

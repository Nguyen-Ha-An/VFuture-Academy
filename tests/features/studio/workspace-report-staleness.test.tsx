// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COURSE_REF, itemRef, makeDiagnostic, type ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  /** Lets each test drive the preview pane the way the real one reports. */
  preview: { report: null as null | ((report: ValidationReport, revision: string) => void) },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, onChange }: { source: string; docRef: { kind: string; id?: string }; onChange: (source: string) => void }) =>
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({
  PreviewPane: ({ sourceRevision, onReport }: { sourceRevision: string; onReport: (report: ValidationReport, revision: string) => void }) => {
    mocks.preview.report = onReport;
    return <div data-testid="preview-revision">{sourceRevision}</div>;
  },
}));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items,
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
};
const clean: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };
const semanticFailure = (message: string): ValidationReport => ({
  ...clean,
  ok: false,
  errors: [{ ...makeDiagnostic('E_ANSWER_REF_UNKNOWN', { ref: itemRef('intro'), path: '/blocks/0' }), message: { en: message, vi: message } }],
});

afterEach(() => { cleanup(); mocks.preview.report = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const revision = () => screen.getByTestId('preview-revision').textContent!;
const open = () => {
  vi.stubGlobal('fetch', vi.fn());
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <Workspace initialDraft={draft} initialReport={clean} recoveryClaim={() => Promise.reject(new Error('no recovery in this suite'))} workflowEnabled={false} />
  </NextIntlClientProvider>);
  return screen.getByRole('textbox', { name: 'JSON editor for manifest' }) as HTMLTextAreaElement;
};

describe('a server report only ever describes the text it was computed from', () => {
  it('drops a report that arrives for text the author has already changed', async () => {
    const editor = open();
    const stale = revision();

    fireEvent.change(editor, { target: { value: editor.value.replace('"Minimal course"', '"Renamed"') } });
    await waitFor(() => expect(revision()).not.toBe(stale));

    // A slow response for the previous text.
    mocks.preview.report!(semanticFailure('Answer refers to an unknown option'), stale);

    expect(screen.queryByRole('button', { name: /Answer refers to an unknown option/ })).not.toBeInTheDocument();
  });

  it('stops showing a semantic error as soon as the author edits, even before the next report', async () => {
    const editor = open();

    mocks.preview.report!(semanticFailure('Answer refers to an unknown option'), revision());
    expect(await screen.findByRole('button', { name: /Answer refers to an unknown option/ })).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: editor.value.replace('"Minimal course"', '"Fixed"') } });

    await waitFor(() => expect(screen.queryByRole('button', { name: /Answer refers to an unknown option/ })).not.toBeInTheDocument());
  });

  it('does not resurrect the previous error when the next preview fails', async () => {
    // The regression: fix a semantic error, then have the following preview fail.
    // The failure must not leave the fixed error on screen looking current.
    const editor = open();
    mocks.preview.report!(semanticFailure('Answer refers to an unknown option'), revision());
    expect(await screen.findByRole('button', { name: /Answer refers to an unknown option/ })).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: editor.value.replace('"Minimal course"', '"Fixed"') } });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Answer refers to an unknown option/ })).not.toBeInTheDocument());

    // The next preview request never produces a report at all.
    const after = revision();
    expect(after).not.toBe('');
    expect(screen.queryByRole('button', { name: /Answer refers to an unknown option/ })).not.toBeInTheDocument();

    // And a report for the *older* revision still cannot bring it back.
    mocks.preview.report!(semanticFailure('Answer refers to an unknown option'), 'some-older-revision');
    expect(screen.queryByRole('button', { name: /Answer refers to an unknown option/ })).not.toBeInTheDocument();
  });

  it('keeps a report that still matches the text on screen', async () => {
    open();
    mocks.preview.report!(semanticFailure('Still true right now'), revision());
    expect(await screen.findByRole('button', { name: /Still true right now/ })).toBeInTheDocument();
  });

  it('reports client-side problems immediately, independently of any server report', async () => {
    const editor = open();
    fireEvent.change(editor, { target: { value: '{ "kind": "course"' } });

    // A structural problem in the author's own text does not wait for a server round trip.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    expect(screen.getByText(/1 errors|errors ·/)).toBeInTheDocument();
  });
});

describe('diagnostics are grouped by document reference', () => {
  it('does not attribute a course diagnostic to an item named `manifest`', async () => {
    open();
    mocks.preview.report!({
      ...clean,
      ok: false,
      errors: [
        { ...makeDiagnostic('E_SCHEMA', { ref: COURSE_REF, path: '/title' }), message: { en: 'Course title problem', vi: 'x' } },
        { ...makeDiagnostic('E_SCHEMA', { ref: itemRef('manifest'), path: '/title' }), message: { en: 'Item called manifest problem', vi: 'y' } },
      ],
    }, revision());

    expect(await screen.findByRole('button', { name: /Course title problem/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Item called manifest problem/ })).toBeInTheDocument();
  });
});

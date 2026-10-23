// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  JsonEditor: ({ source, docRef, readOnly, onChange }: { source: string; docRef: { kind: string; id?: string }; readOnly: boolean; onChange: (source: string) => void }) => <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} readOnly={readOnly} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => null }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => <button type="button">Import</button> }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({
  VersionsDrawer: ({ beforeRestore, onRestored }: { beforeRestore?: () => Promise<boolean>; onRestored: (snapshot: { manifest: unknown; items: Record<string, unknown>; baseVersionId: null }) => void }) => (
    <button type="button" onClick={async () => {
      if (!beforeRestore || await beforeRestore()) onRestored({ manifest: { id: 'forbidden' }, items: {}, baseVersionId: null });
    }}>Restore version</button>
  ),
}));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const draft: WorkspaceDraft = { id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z' };
const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };

afterEach(() => { cleanup(); mocks.router.push.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('read-only workspace', () => {
  it('exposes readable JSON without save, publish, import, or outline mutation controls', async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} readOnly /></NextIntlClientProvider>);

    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add module' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove module/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore version' }));
    await Promise.resolve();
    expect((screen.getByRole('textbox', { name: 'JSON editor for manifest' }) as HTMLTextAreaElement).value).toContain('Minimal course');
  });

  it('never exposes the author review workflow from a read-only workspace', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} readOnly /></NextIntlClientProvider>);

    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Content review workflow' })).not.toBeInTheDocument();
  });

  it('ignores editor changes and keyboard save attempts', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} readOnly /></NextIntlClientProvider>);
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    const original = (editor as HTMLTextAreaElement).value;

    fireEvent.change(editor, { target: { value: '{}' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    expect(editor).toHaveValue(original);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

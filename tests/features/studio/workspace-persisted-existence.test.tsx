// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import { inlineWorkspace, parseWorkspace } from '@/content-engine/validate';
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

const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };

afterEach(() => { cleanup(); mocks.router.push.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Workspace document existence', () => {
  it('splits legacy inline items into separately selectable source documents', () => {
    const parsed = parseWorkspace(FIXTURES.minimal);
    if (!parsed.parsed) throw new Error('Expected valid fixture');
    const draft: WorkspaceDraft = {
      id: 'draft-1', courseId: 'minimal', manifest: inlineWorkspace(parsed.parsed), items: {},
      baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
    };
    render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} workflowEnabled={false} /></NextIntlClientProvider>);

    const manifest = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    expect((manifest as HTMLTextAreaElement).value).not.toContain('Post one sentence');
    fireEvent.click(screen.getByText('Say hello').closest('button')!);
    expect((screen.getByRole('textbox', { name: 'JSON editor for hello' }) as HTMLTextAreaElement).value).toContain('Post one sentence');
  });

  it('keeps a persisted split item as the authoritative selected source', () => {
    const persistedIntro = { ...(FIXTURES.minimal.items.intro as Record<string, unknown>), title: 'Persisted lesson' };
    const draft: WorkspaceDraft = {
      id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: { intro: persistedIntro },
      baseVersionId: null, checklist: {}, updatedAt: '2026-09-05T07:00:00.000Z',
    };
    render(<NextIntlClientProvider locale="en" messages={messages}><Workspace initialDraft={draft} initialReport={report} workflowEnabled={false} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByText('Persisted lesson').closest('button')!);
    expect((screen.getByRole('textbox', { name: 'JSON editor for intro' }) as HTMLTextAreaElement).value).toContain('Persisted lesson');
  });
});

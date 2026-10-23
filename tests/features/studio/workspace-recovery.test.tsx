// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '@/content-engine/diagnostics';
import { FIXTURES } from '@/content-engine/fixtures';
import {
  RECOVERY_TTL_MS, memoryRecoveryStorage, recoveryKey, saveRecovery,
  type RecoveryStorage, type TabOwnership,
} from '@/features/studio/recovery';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/features/studio/ui/JsonEditor', () => ({
  structuralDiagnosticsForSource: () => [],
  JsonEditor: ({ source, docRef, readOnly, onChange }: { source: string; docRef: { kind: string; id?: string }; readOnly?: boolean; onChange: (source: string) => void }) =>
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} readOnly={readOnly} onChange={(event) => onChange(event.currentTarget.value)} />,
}));
vi.mock('@/features/studio/ui/PreviewPane', () => ({ PreviewPane: () => null }));
vi.mock('@/features/studio/ui/ImportDialog', () => ({ ImportDialog: () => null }));
vi.mock('@/features/studio/ui/VersionsDrawer', () => ({ VersionsDrawer: () => null }));

import { Workspace, type WorkspaceDraft } from '@/features/studio/ui/Workspace';

const messages = staffUiTestMessages(enMessages, 'en');

const REVISION = '2026-09-05T07:00:00.000Z';
const draft: WorkspaceDraft = {
  id: 'draft-1', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items,
  baseVersionId: null, checklist: {}, updatedAt: REVISION,
};
const report: ValidationReport = { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } };
const scope = { accountId: 'author-1', scopeKey: 'central', courseId: 'minimal', tabId: 'tab-a' };
const ownership = (tabId = 'tab-a', priorTabId: string | null = null): TabOwnership =>
  ({ tabId, rekeyed: false, durable: true, priorTabId, dispose: () => undefined });

let storage: RecoveryStorage;
beforeEach(() => { storage = memoryRecoveryStorage(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function open(overrides: Partial<Parameters<typeof Workspace>[0]> = {}) {
  return render(<NextIntlClientProvider locale="en" messages={messages}>
    <Workspace
      initialDraft={draft}
      initialReport={report}
      accountId={scope.accountId}
      scopeKey={scope.scopeKey}
      recoveryStorage={storage}
      recoveryClaim={() => Promise.resolve(ownership())}
      recoveryDebounceMs={10}
      workflowEnabled={false}
      {...overrides}
    />
  </NextIntlClientProvider>);
}

const editManifest = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'JSON editor for manifest' }), { target: { value } });
const storedRecord = () => storage.read(recoveryKey(scope));

describe('local recovery persistence', () => {
  it('keeps invalid raw text after a debounce and offers it on the next open', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());

    editManifest('{ "kind": "course", "id": "minimal"');
    await waitFor(async () => expect(await storedRecord()).not.toBeNull());
    const record = (await storedRecord())!;
    expect(record.sources.course).toBe('{ "kind": "course", "id": "minimal"');
    expect(record.baseUpdatedAt).toBe(REVISION);

    // A refresh: the server draft loads, and the stored text is only ever offered.
    cleanup();
    open();
    expect(await screen.findByText(/Unsaved edits found on this device/)).toBeInTheDocument();
    // The server draft is what loaded; the stored text is only offered.
    expect((screen.getByRole('textbox', { name: 'JSON editor for manifest' }) as HTMLTextAreaElement).value).toContain('"title": "Minimal course"');

    fireEvent.click(screen.getByRole('button', { name: /Restore edits/ }));
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue('{ "kind": "course", "id": "minimal"');
  });

  it('does not write anything until the debounce elapses', async () => {
    vi.useFakeTimers();
    open({ recoveryDebounceMs: 300 });
    await act(async () => { await Promise.resolve(); });

    editManifest('{ "typing": true');
    await act(async () => { await vi.advanceTimersByTimeAsync(290); });
    expect(await storedRecord()).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(await storedRecord()).not.toBeNull();
  });

  it('flushes pending text when the page is hidden', async () => {
    vi.useFakeTimers();
    open({ recoveryDebounceMs: 5_000 });
    await act(async () => { await Promise.resolve(); });
    editManifest('{ "half-typed": true');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });

    expect((await storedRecord())?.sources.course).toBe('{ "half-typed": true');
  });

  it('never persists anything for a read-only viewer', async () => {
    open({ readOnly: true });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    editManifest('{ "attempted": true');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(await storedRecord()).toBeNull();
  });
});

describe('local recovery isolation', () => {
  const seed = (overrides: Partial<typeof scope>) =>
    saveRecovery(storage, { ...scope, ...overrides }, { sources: { course: '{"other":true' }, baseUpdatedAt: REVISION, baseVersionId: null });

  it('ignores a record belonging to another account', async () => {
    await seed({ accountId: 'author-2' });
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
  });

  it('ignores a record belonging to another permission scope', async () => {
    await seed({ scopeKey: 'branch:hcm' });
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
  });

  it('ignores a record belonging to another course or another tab', async () => {
    await seed({ courseId: 'other-course' });
    await seed({ tabId: 'tab-b' });
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
  });

  it('ignores a record older than seven days', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"stale":true' }, baseUpdatedAt: REVISION, baseVersionId: null }, Date.now() - RECOVERY_TTL_MS - 1);
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
    expect(await storedRecord()).toBeNull();
  });

  it('offers a previous session record when tab uniqueness could not be verified', async () => {
    await seed({ tabId: 'previous-tab' });
    open({ recoveryClaim: () => Promise.resolve({ tabId: 'fresh-tab', rekeyed: true, durable: false, priorTabId: 'previous-tab', dispose: () => undefined }) });
    expect(await screen.findByText(/Unsaved edits found/)).toBeInTheDocument();
  });
});

describe('protecting newer server content', () => {
  it('warns when the saved draft has moved on, and still never restores by itself', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"older":true' }, baseUpdatedAt: '2026-09-05T06:00:00.000Z', baseVersionId: null });
    open();

    expect(await screen.findByText(/saved draft has changed since these edits/)).toBeInTheDocument();
    // The editor still shows the server draft: nothing was overwritten.
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).not.toHaveValue('{"older":true');
  });

  it('lets a read-only viewer download but not restore', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"kept":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    open({ readOnly: true });

    expect(await screen.findByText(/read-only access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore edits/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download edits/ })).toBeInTheDocument();
  });
});

describe('clearing recovery', () => {
  const okResponse = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('clears the record after a save, but keeps text typed while the save was in flight', async () => {
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      await new Promise<void>(resolve => { release = resolve; });
      return okResponse({ ...draft, ...body, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());

    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    const first = String((editor as HTMLTextAreaElement).value).replace('"Minimal course"', '"Saved title"');
    fireEvent.change(editor, { target: { value: first } });
    await waitFor(async () => expect(await storedRecord()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(release).not.toBeNull());

    // Typed while the request is outstanding.
    fireEvent.change(editor, { target: { value: first.replace('"Saved title"', '"Newer title"') } });
    await waitFor(async () => expect((await storedRecord())?.sources.course).toContain('Newer title'));

    release!();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());

    // The acknowledgement only matched the older snapshot, so the newer text stays.
    expect((await storedRecord())?.sources.course).toContain('Newer title');
  });

  it('clears the record when the acknowledged text is still the current text', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return okResponse({ ...draft, ...body, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
    fireEvent.change(editor, { target: { value: String((editor as HTMLTextAreaElement).value).replace('"Minimal course"', '"Saved title"') } });
    await waitFor(async () => expect(await storedRecord()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(async () => expect(await storedRecord()).toBeNull());
  });

  it('discards this tab record on request', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"kept":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    await saveRecovery(storage, { ...scope, tabId: 'tab-b' }, { sources: { course: '{"other":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    open();
    expect(await screen.findByText(/Unsaved edits found/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Delete stored edits/ }));

    await waitFor(async () => expect(await storedRecord()).toBeNull());
    expect(await storage.read(recoveryKey({ ...scope, tabId: 'tab-b' }))).not.toBeNull();
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
  });

  it('clears this account records when the author signs out', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"a":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    await saveRecovery(storage, { ...scope, accountId: 'author-2' }, { sources: { course: '{"b":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    open();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());

    const form = document.createElement('form');
    form.setAttribute('action', '/auth/signout');
    document.body.append(form);
    fireEvent.submit(form);

    await waitFor(async () => expect(await storedRecord()).toBeNull());
    expect((await storage.list()).map(record => record.accountId)).toEqual(['author-2']);
  });
});

describe('storage failures stay visible and never block editing', () => {
  it('reports a quota failure and keeps the editor usable', async () => {
    const failing: RecoveryStorage = { ...memoryRecoveryStorage(), write: () => Promise.reject(new Error('QuotaExceededError')) };
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <Workspace initialDraft={draft} initialReport={report} accountId={scope.accountId} scopeKey={scope.scopeKey}
        recoveryStorage={failing} recoveryClaim={() => Promise.resolve(ownership())} recoveryDebounceMs={5} workflowEnabled={false} />
    </NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());

    editManifest('{ "typed": true');

    expect(await screen.findByText(/no room left to keep unsaved edits/)).toBeInTheDocument();
    // Editing continues and the download escape hatch is still offered.
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue('{ "typed": true');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('reports an unavailable store on open', async () => {
    const failing: RecoveryStorage = { ...memoryRecoveryStorage(), read: () => Promise.reject(new Error('no indexedDB')), list: () => Promise.reject(new Error('no indexedDB')) };
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <Workspace initialDraft={draft} initialReport={report} accountId={scope.accountId} scopeKey={scope.scopeKey}
        recoveryStorage={failing} recoveryClaim={() => Promise.resolve(ownership())} workflowEnabled={false} />
    </NextIntlClientProvider>);

    expect(await screen.findByText(/will not store unsaved edits/)).toBeInTheDocument();
  });
});

describe('restoring is confirmed when it would replace something', () => {
  it('restores in one click when there is nothing to lose', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"kept":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    open();
    expect(await screen.findByText(/Unsaved edits found/)).toBeInTheDocument();

    // Same base revision and a clean editor: no confirmation needed.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore edits/ })).toBeEnabled();
  });

  it('requires one explicit confirmation when the saved draft has moved on', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"older":true' }, baseUpdatedAt: '2026-09-05T06:00:00.000Z', baseVersionId: null });
    open();
    expect(await screen.findByText(/saved draft has changed since these edits/)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Restore edits/ })).toBeDisabled();
    const confirm = screen.getByRole('checkbox');
    expect(confirm).toBeInTheDocument();

    fireEvent.click(confirm);
    expect(screen.getByRole('button', { name: /Restore edits/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Restore edits/ }));
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue('{"older":true');
  });

  it('requires confirmation when the author has already typed in this session', async () => {
    await saveRecovery(storage, scope, { sources: { course: '{"recovered":true' }, baseUpdatedAt: REVISION, baseVersionId: null });
    open();
    expect(await screen.findByText(/Unsaved edits found/)).toBeInTheDocument();

    // Typing makes the restore destructive.
    editManifest('{ "typed in this session": true');
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Restore edits/ })).toBeDisabled();
    expect(screen.getByText(/Replace the edits currently open in the editor/)).toBeInTheDocument();

    // Download and Discard never need a confirmation.
    expect(screen.getByRole('button', { name: /Download edits/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Delete stored edits/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Restore edits/ }));
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue('{"recovered":true');
  });

  it('refuses a record whose source keys this build cannot have written', async () => {
    // Written by hand or by a pre-refactor build that keyed sources by docId.
    await storage.write({
      ...scope, version: 1, key: recoveryKey(scope),
      sources: { manifest: '{"legacy":true' } as Record<string, string>,
      baseUpdatedAt: REVISION, baseVersionId: null, modifiedAt: Date.now(),
    });
    open();

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toBeInTheDocument());
    expect(screen.queryByText(/Unsaved edits found/)).not.toBeInTheDocument();
    // No phantom document was materialised.
    expect(screen.queryByRole('textbox', { name: 'JSON editor for est' })).not.toBeInTheDocument();
  });
});

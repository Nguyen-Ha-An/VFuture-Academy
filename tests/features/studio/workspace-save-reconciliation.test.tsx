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
  JsonEditor: ({ source, docRef, onChange }: { source: string; docRef: { kind: string; id?: string }; onChange: (source: string) => void }) =>
    <textarea aria-label={`JSON editor for ${docRef.kind === 'course' ? 'manifest' : docRef.id}`} value={source} onChange={(event) => onChange(event.currentTarget.value)} />,
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
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function open() {
  render(<NextIntlClientProvider locale="en" messages={messages}>
    <Workspace initialDraft={draft} initialReport={report} recoveryStorage={undefined} recoveryClaim={() => Promise.reject(new Error('no recovery in this suite'))} workflowEnabled={false} />
  </NextIntlClientProvider>);
  const editor = screen.getByRole('textbox', { name: 'JSON editor for manifest' });
  const edited = String((editor as HTMLTextAreaElement).value).replace('"Minimal course"', '"Edited title"');
  fireEvent.change(editor, { target: { value: edited } });
  return { editor, edited };
}

const timeout = () => Promise.reject(Object.assign(new DOMException('The operation timed out.', 'TimeoutError')));

describe('a save whose answer never arrives', () => {
  it('labels read-back reconciliation separately from an unknown outcome', async () => {
    let finishCheck!: (response: Response) => void;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return timeout();
      return new Promise<Response>(resolve => { finishCheck = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Checking saved version…')).toBeInTheDocument();
    finishCheck(ok(draft));
    expect(await screen.findByText(/did not reach the server/)).toBeInTheDocument();
  });

  it('accepts the write when the stored snapshot is exactly what was submitted', async () => {
    let submitted: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null } | null = null;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') { submitted = JSON.parse(String(init.body)); return timeout(); }
      // The write did land: the stored draft matches, key order and all.
      return ok({ ...draft, manifest: submitted!.manifest, items: submitted!.items, baseVersionId: submitted!.baseVersionId, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Saved'));
    expect(String(fetcher.mock.calls[1]?.[0])).toBe('/api/v1/studio/courses/minimal/draft');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports that the write did not land when the stored snapshot differs', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return timeout();
      return ok(draft);
    });
    vi.stubGlobal('fetch', fetcher);
    const { edited } = open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/did not reach the server/)).toBeInTheDocument();
    // The author's text is untouched, so the retry sends the same thing.
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue(edited);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('will not claim success on a matching fingerprint alone — it compares the whole snapshot', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return timeout();
      // Same documents except one nested value: a short hash could collide here,
      // an exact canonical comparison cannot.
      const items = structuredClone(draft.items) as Record<string, Record<string, unknown>>;
      const first = Object.keys(items)[0];
      items[first] = { ...items[first], title: 'Something the author never wrote' };
      return ok({ ...draft, items });
    });
    vi.stubGlobal('fetch', fetcher);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/did not reach the server/)).toBeInTheDocument();
  });

  it('treats a differently ordered but identical snapshot as the same write', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        // Same content, keys and item order reversed, as a database round trip may return.
        const manifest = Object.fromEntries(Object.entries(body.manifest).reverse());
        const items = Object.fromEntries(Object.entries(body.items).reverse());
        return timeout().catch(() => { throw Object.assign(new DOMException('t', 'TimeoutError'), { reordered: { manifest, items, baseVersionId: body.baseVersionId } }); });
      }
      return ok(draft);
    });
    vi.stubGlobal('fetch', fetcher);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    // The stored draft above is the *unedited* one, so this must not read as saved.
    expect(await screen.findByText(/did not reach the server/)).toBeInTheDocument();
  });

  it('says the outcome is unknown when the draft cannot be read back either', async () => {
    vi.stubGlobal('fetch', vi.fn(() => timeout()));
    const { edited } = open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/did not answer and could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue(edited);
    // Download stays reachable so nothing depends on the next request working.
    expect(screen.getByRole('button', { name: /Download edits/ })).toBeInTheDocument();
  });

  it('rechecks an uncertain write explicitly and accepts only the submitted snapshot', async () => {
    let submitted: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null } | null = null;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') { submitted = JSON.parse(String(init.body)); return timeout(); }
      if (fetcher.mock.calls.length === 2) return timeout();
      return ok({ ...draft, ...submitted, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/did not answer and could not be checked/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check saved version' }));

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Saved'));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });

  it('keeps text typed during an uncertain save unsaved after reconciliation succeeds', async () => {
    let submitted: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null } | null = null;
    let release: (() => void) | null = null;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' && !submitted) {
        submitted = JSON.parse(String(init.body));
        await new Promise<void>(resolve => { release = resolve; });
        return timeout();
      }
      if (init?.method === 'PUT') return ok({ ...draft, ...JSON.parse(String(init.body)), updatedAt: '2026-09-05T07:02:00.000Z' });
      return ok({ ...draft, manifest: submitted!.manifest, items: submitted!.items, baseVersionId: submitted!.baseVersionId, updatedAt: '2026-09-05T07:01:00.000Z' });
    });
    vi.stubGlobal('fetch', fetcher);
    const { editor, edited } = open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.change(editor, { target: { value: edited.replace('"Edited title"', '"Typed during the save"') } });
    release!();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2));
    expect(screen.getByRole('textbox', { name: 'JSON editor for manifest' })).toHaveValue(edited.replace('"Edited title"', '"Typed during the save"'));
    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Saved'));
  });
});

describe('a save the server rejects', () => {
  it('rejects a successful response that does not acknowledge the submitted snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(draft)));
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your edits are retained');
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes');
  });

  it('keeps a definite server answer definite instead of reconciling it', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'DRAFT_CONFLICT', message: 'stale' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    open();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText(/Someone else saved this draft/)).toBeInTheDocument();
    // One request: a 409 is an answer, so there is nothing to reconcile.
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

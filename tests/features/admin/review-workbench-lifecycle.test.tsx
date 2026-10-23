// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { ReviewQueue, type ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const messages = staffUiTestMessages(en, 'en');
const row: ReviewRow = { id: 'review-1', content_type: 'resource', content_id: 'guide', status: 'approved', owner_branch_id: null, submitted_at: '2026-09-06T00:00:00Z', decision_note: null, self_review: false, revision_key: 'v2', checksum: 'x', dependencies: [] };
const view = (canPublish = true, status = row.status) => <NextIntlClientProvider locale="en" messages={messages}><ReviewQueue scope={{ kind: 'central' }} actorId="operator" branches={[]} rows={[{ ...row, status }]} canReview canPublish={canPublish} /></NextIntlClientProvider>;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('review workbench publication', () => {
  it('completes legacy approved publication through the atomic endpoint with a required note', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { data: { status: 'published' } } : { data: { review: row, snapshot: { revision_key: 'v2', ownership_kind: 'central', owner_branch_id: null, audience: {}, dependencies: [] }, reviewed_source: { title: 'Guide' }, published_snapshot: null } })));
    vi.stubGlobal('fetch', fetch); render(view());
    await userEvent.click(screen.getByRole('button', { name: 'Complete publication' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Review note (required)'), 'Verified the final version');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/reviews/review-1/approve-and-publish'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedRevision: 'v2', note: 'Verified the final version' }) }));
  });
  it('allows a reviewer without publication permission to request changes but never approve', () => {
    render(view(false, 'pending'));
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Complete publication' })).not.toBeInTheDocument();
  });
  it('keeps atomic publication retryable when a 200 response reports stale', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'stale' } })));
    vi.stubGlobal('fetch', fetch); render(view());
    await userEvent.click(screen.getByRole('button', { name: 'Complete publication' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Review note (required)'), 'Checked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Complete publication' })).toBeEnabled();
  });
  it('does not restore a completed publication when stale server rows arrive late', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'published' } })));
    vi.stubGlobal('fetch', fetch); const rendered = render(view());
    await userEvent.click(screen.getByRole('button', { name: 'Complete publication' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Review note (required)'), 'Checked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and publish' }));
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalled());
    rendered.rerender(view());
    expect(screen.queryByRole('button', { name: 'Complete publication' })).not.toBeInTheDocument();
  });
  it('uses a newer approved preview state while the original pending row arrives late', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { review: { ...row, status: 'approved' }, snapshot: { revision_key: 'v2', ownership_kind: 'central', owner_branch_id: null, audience: {}, dependencies: [] }, reviewed_source: { title: 'Guide' }, published_snapshot: null } })));
    vi.stubGlobal('fetch', fetch); const rendered = render(view(true, 'pending'));
    await userEvent.click(screen.getByRole('button', { name: 'Read submitted version' }));
    expect(await screen.findByRole('button', { name: 'Complete publication' })).toBeEnabled();
    rendered.rerender(view(true, 'pending'));
    expect(screen.getByRole('button', { name: 'Complete publication' })).toBeEnabled();
  });
  it('keeps a failed publication available for a retry after a server failure', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Publication could not be saved' } }), { status: 503 }));
    vi.stubGlobal('fetch', fetch); render(view());
    await userEvent.click(screen.getByRole('button', { name: 'Complete publication' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Review note (required)'), 'Checked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Publication could not be saved');
    expect(screen.getByRole('button', { name: 'Complete publication' })).toBeEnabled();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});

it('respects the content-specific publication permission of a custom reviewer role', () => {
  render(<NextIntlClientProvider locale="en" messages={messages}><ReviewQueue scope={{kind:'central'}} actorId="operator" branches={[]} rows={[{...row,status:'pending'}]} canReview canPublish publishableTypes={['course']} /></NextIntlClientProvider>);
  expect(screen.getByRole('button',{name:'Request changes'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:'Approve and publish'})).toBeNull();
});

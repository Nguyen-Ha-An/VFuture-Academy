// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { ContentInventory, ReviewQueue, type ContentRow, type ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, usePathname: () => '/studio/library', useSearchParams: () => new URLSearchParams(navigation.search) }));
const messages = staffUiTestMessages(en, 'en');
const props = { scope: { kind: 'central' as const }, actorId: 'operator', branches: [{ id: 'ans', name: 'ANS' }] };
const SUBMITTER = '00000000-0000-4000-8000-0000000000aa';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); navigation.search = ''; });

function provider(content: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">{content}</NextIntlClientProvider>;
}

function contentRow(index: number, overrides: Partial<ContentRow> = {}): ContentRow {
  return { content_type: 'resource', content_id: `item-${index}`, title: `Item ${index}`, audience: { scope: 'global' }, status: 'draft', ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-09-06T00:00:00Z', revision_key: `v${index}`, review_status: null, studio_href: `/studio/resources/item-${index}`, ...overrides };
}

describe('Content library data card', () => {
  const rows = [...Array.from({ length: 28 }, (_, index) => contentRow(index + 1)), contentRow(29, { status: 'published', content_type: 'course', title: 'Live course' }), contentRow(30, { review_status: 'pending', title: 'Waiting guide' })];

  it('pages the fully loaded list on the client with an honest total', () => {
    render(provider(<ContentInventory {...props} rows={rows} creatableTypes={[]} requestableKeys={[]} />));
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(26);
    cleanup();
    navigation.search = 'page=2';
    render(provider(<ContentInventory {...props} rows={rows} creatableTypes={[]} requestableKeys={[]} />));
    expect(screen.getByText('Showing 26–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Waiting guide' })).toHaveAttribute('href', '/studio/resources/item-30');
  });

  it('reads search, type and lifecycle stage from the URL and writes filter changes back', async () => {
    navigation.search = 'status=in_review&page=3';
    render(provider(<ContentInventory {...props} rows={rows} creatableTypes={[]} requestableKeys={[]} />));
    expect(screen.getByRole('link', { name: 'Waiting guide' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('In review', { selector: '[data-tone]' })).toHaveAttribute('data-tone', 'warning');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Content type' }), 'course');
    expect(navigation.replace).toHaveBeenCalledWith('/studio/library?status=in_review&type=course', { scroll: false });
  });

  it('narrows to the CMS deep link id until the viewer asks for everything', async () => {
    navigation.search = 'type=resource&id=item-3';
    render(provider(<ContentInventory {...props} rows={rows} creatableTypes={[]} requestableKeys={[]} />));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText(/Showing one item: item-3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all content' }));
    expect(navigation.replace).toHaveBeenCalledWith('/studio/library?type=resource', { scroll: false });
  });
});

describe('Review queue master–detail', () => {
  const pending: ReviewRow = { id: 'review-1', content_type: 'course', content_id: 'python', status: 'pending', owner_branch_id: null, submitted_at: '2026-09-06T00:00:00Z', decision_note: null, self_review: false, revision_key: 'v2', checksum: 'x', dependencies: [], submitted_by: SUBMITTER };
  const other: ReviewRow = { ...pending, id: 'review-2', content_type: 'resource', content_id: 'guide', submitted_by: null, submitted_at: '2026-09-07T00:00:00Z' };
  const earlier: ReviewRow = { ...pending, id: 'review-0', status: 'changes_requested', decision_note: 'Add alt text', submitted_at: '2026-09-01T00:00:00Z' };
  const titles = { 'course:python': { vi: 'Python cơ bản', en: 'Python basics' } };

  it('keeps the list beside the detail and shows decision buttons only in the detail once a request is open', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { review: pending, snapshot: { revision_key: 'v2', ownership_kind: 'central', owner_branch_id: null, audience: { scope: 'global' }, dependencies: [] }, reviewed_source: { title: 'Python basics' }, published_snapshot: null } })));
    vi.stubGlobal('fetch', fetch);
    render(provider(<ReviewQueue {...props} rows={[pending, other, earlier]} canReview canPublish titles={titles} submitters={{ [SUBMITTER]: 'Nguyễn Minh Anh' }} />));
    expect(screen.getAllByRole('heading', { name: 'Python basics' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'guide' })).toBeInTheDocument();
    expect(screen.getAllByText('Submitted by Nguyễn Minh Anh')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Approve and publish' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Select a review request' })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Read submitted version' })[0]);
    const detail = await screen.findByRole('region', { name: 'Read submitted version: Python basics' });
    expect(screen.getAllByRole('button', { name: 'Approve and publish' })).toHaveLength(1);
    expect(within(detail).getByRole('button', { name: 'Approve and publish' })).toBeEnabled();
    expect(screen.queryAllByRole('button', { name: 'Request changes' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'guide' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Review requests' })).getAllByRole('heading', { name: 'Python basics' }).map((heading) => heading.closest('li')?.getAttribute('aria-current') ?? null)).toEqual(['true', null]);

    await userEvent.click(within(detail).getByRole('tab', { name: 'History' }));
    const history = within(detail).getByRole('region', { name: 'Review history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
    expect(within(history).getByText('Awaiting Central review')).toHaveClass('bg-warning');
    expect(within(history).getByText('Changes requested')).toHaveClass('bg-destructive/10');
    expect(within(history).getByText('Add alt text')).toBeInTheDocument();
    expect(within(history).getAllByText(/by Nguyễn Minh Anh/)).toHaveLength(2);

    await userEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.getAllByRole('button', { name: 'Approve and publish' })).toHaveLength(2);
  });
});

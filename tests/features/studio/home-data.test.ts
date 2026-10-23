import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ context: vi.fn(), listContent: vi.fn(), listReviews: vi.fn(), actors: vi.fn(), locale: 'en' }));
vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getLocale: async () => mocks.locale }));
vi.mock('@/features/workspace/context', () => ({ studioPageContext: mocks.context }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/admin/content-review', () => ({ createContentReviewService: () => ({ listContent: mocks.listContent, listReviews: mocks.listReviews }) }));
vi.mock('@/features/admin/actor-directory', () => ({ actorDisplayNames: mocks.actors }));

import { studioHomeData, studioReviewsData, type StudioHomeData } from '@/features/studio/home-data';
import { StudioHomeView } from '@/features/studio/ui/StudioHomeView';

const SUBMITTER = '00000000-0000-4000-8000-0000000000aa';
const branches = [{ id: 'ans', name: 'ANS · Hà Nội', city: null, createdAt: '' }];
const reviewer = { permissions: ['content.review', 'content.read', 'content.publish'], actor: { userId: 'reviewer', roles: [] }, scope: { kind: 'central' }, branches };
const author = { permissions: ['course.read', 'resource.edit'], actor: { userId: 'author', roles: [] }, scope: { kind: 'central' }, branches };

const content = [
  { content_type: 'course', content_id: 'python', title: { vi: 'Python cơ bản', en: 'Python basics' }, status: 'draft', review_status: 'pending', ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-09-20T08:00:00Z', studio_href: '/studio/courses/python' },
  { content_type: 'course', content_id: 'ai', title: 'AI', status: 'published', review_status: 'published', ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-09-10T08:00:00Z', studio_href: '/studio/courses/ai' },
  { content_type: 'resource', content_id: 'guide', title: { en: 'Guide' }, status: 'published', review_status: 'withdrawn', ownership_kind: 'branch', owner_branch_id: 'ans', updated_at: '2026-09-22T08:00:00Z', studio_href: '/studio/library?type=resource&id=guide' },
  { content_type: 'resource', content_id: 'old', title: 'Old', status: 'archived', review_status: null, ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-01-01T00:00:00Z', studio_href: 'https://evil.example/x' },
  { content_type: 'media_asset', content_id: 'img', title: null, status: 'asset', review_status: null, ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-09-01T00:00:00Z', studio_href: '/studio/media' },
];
const reviews = [
  { id: 'r2', content_type: 'course', content_id: 'python', status: 'pending', submitted_by: SUBMITTER, submitted_at: '2026-09-21T08:00:00Z', ownership_kind: 'central', owner_branch_id: null },
  { id: 'r1', content_type: 'resource', content_id: 'guide', status: 'pending', submitted_by: null, submitted_at: '2026-09-19T08:00:00Z', ownership_kind: 'branch', owner_branch_id: 'ans' },
  { id: 'r0', content_type: 'course', content_id: 'ai', status: 'published', submitted_by: SUBMITTER, submitted_at: '2026-09-09T08:00:00Z', ownership_kind: 'central', owner_branch_id: null },
];

function render(data: StudioHomeData, locale: 'en' | 'vi' = 'en') {
  const intl = { locale, messages: staffUiTestMessages(enMessages, 'en'), timeZone: 'UTC' } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(StudioHomeView, { data })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.listContent.mockResolvedValue(content);
  mocks.listReviews.mockResolvedValue(reviews);
  mocks.actors.mockResolvedValue(new Map([[SUBMITTER, { name: 'Nguyễn Minh Anh', avatarUrl: null, initials: 'MA' }]]));
});

describe('studioHomeData', () => {
  it('counts one lifecycle stage per item and keeps media assets without a live review out of the snapshot', async () => {
    mocks.context.mockResolvedValue(reviewer);
    const data = await studioHomeData();
    if (data.content.state !== 'ready') throw new Error('content should be ready');
    // withdrawn review → draft even though the resource is published (lifecycle.ts rule).
    expect(data.content.stages).toEqual({ draft: 1, in_review: 1, changes_requested: 0, approved: 0, published: 1, archived: 1 });
    expect(data.content.total).toBe(4);
    expect(data.content.byType.map((row) => row.contentType)).toEqual(['course', 'resource']);
    expect(data.content.recent[0]).toMatchObject({ title: 'Guide', stage: 'draft' });
    // A non-Studio link from data never becomes an href.
    expect(data.content.recent.find((row) => row.key === 'resource:old')?.href).toBe('/studio/library');
  });

  it('lists the oldest waiting requests first with resolved titles, owners and submitter names', async () => {
    mocks.context.mockResolvedValue(reviewer);
    const data = await studioHomeData();
    expect(data.reviewer).toBe(true);
    expect(data.primary).toMatchObject({ key: 'reviews', href: '/studio/reviews' });
    if (data.reviews.state !== 'ready') throw new Error('reviews should be ready');
    expect(data.reviews.pending).toBe(2);
    expect(data.reviews.waiting.map((row) => [row.title, row.owner, row.submitter])).toEqual([
      ['Guide', { kind: 'branch', name: 'ANS · Hà Nội' }, null],
      ['Python basics', { kind: 'central' }, 'Nguyễn Minh Anh'],
    ]);
    expect(mocks.actors).toHaveBeenCalledWith(expect.arrayContaining([SUBMITTER]));
  });

  it('merges content updates and named submissions in the activity feed, newest first', async () => {
    mocks.context.mockResolvedValue(reviewer);
    const data = await studioHomeData();
    if (data.activity.state !== 'ready') throw new Error('activity should be ready');
    expect(data.activity.items.slice(0, 3).map((item) => [item.kind, item.target])).toEqual([
      ['updated', 'Guide'],
      ['submitted', 'Python basics'],
      ['updated', 'Python basics'],
    ]);
    expect(data.activity.items[1].actor).toEqual({ kind: 'person', name: 'Nguyễn Minh Anh', avatarUrl: null });
  });

  it('hides review cards without review permission and reports a failed read as unavailable, never zero', async () => {
    mocks.context.mockResolvedValue(author);
    mocks.listContent.mockRejectedValue(new Error('database down'));
    const data = await studioHomeData();
    expect(data.reviews).toEqual({ state: 'hidden' });
    expect(data.content).toEqual({ state: 'unavailable' });
    expect(mocks.listReviews).not.toHaveBeenCalled();
    const html = render(data);
    expect(html).toContain('Unavailable');
    expect(html).not.toMatch(/<dd[^>]*><span[^>]*>0<\/span>/);
    expect(html).not.toContain('Open review queue');
  });
});

describe('StudioHomeView', () => {
  it('renders snapshot KPIs without deltas, linked to the filtered library, plus lifecycle strip and anchor queue', async () => {
    mocks.context.mockResolvedValue(reviewer);
    const html = render(await studioHomeData());
    expect(html).toContain('<dl');
    expect(html).not.toContain('data-slot="stat-delta"');
    expect(html).toContain('href="/studio/library?status=draft"');
    expect(html).toContain('href="/studio/library?status=changes_requested"');
    for (const stage of ['draft', 'in_review', 'changes_requested', 'approved', 'published', 'archived']) expect(html).toContain(`data-stage="${stage}"`);
    expect(html).toContain('Content by type');
    expect(html).toContain('Waiting for review');
    expect(html).toContain('by Nguyễn Minh Anh');
    expect(html).toContain('Nguyễn Minh Anh</span> submitted for review');
    expect(html).toContain('ANS · Hà Nội</span> updated');
  });

  it('anchors authors on recent content instead of the review queue', async () => {
    mocks.context.mockResolvedValue(author);
    const data = await studioHomeData();
    expect(data.reviewer).toBe(false);
    const html = render(data);
    expect(html).toContain('Recent content');
    expect(html).toContain('href="/studio/courses/python"');
    expect(html).not.toContain('Longest-waiting requests first.');
  });
});

describe('studioReviewsData', () => {
  it('passes stored titles and submitter names, and keeps ids when the content read fails', async () => {
    mocks.context.mockResolvedValue(reviewer);
    const data = await studioReviewsData();
    expect(data.titles['course:python']).toEqual({ vi: 'Python cơ bản', en: 'Python basics' });
    expect(data.submitters).toEqual({ [SUBMITTER]: 'Nguyễn Minh Anh' });
    mocks.listContent.mockRejectedValue(new Error('forbidden'));
    expect((await studioReviewsData()).titles).toEqual({});
  });
});

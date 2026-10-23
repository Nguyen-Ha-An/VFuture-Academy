// @vitest-environment jsdom
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  resources: { listPage: vi.fn(), get: vi.fn() },
  opportunities: { listPage: vi.fn(), get: vi.fn() },
  catalog: vi.fn(),
  push: vi.fn(),
  pathname: '/app/opportunities',
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('not_found'); }),
  redirect: vi.fn(),
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'learner-1' })) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/ecosystem/context', () => ({ learnerContext: vi.fn(async () => ({ userId: 'learner-1', branchId: null, locale: 'en' })) }));
vi.mock('@/features/catalog/service', () => ({ listCatalog: mocks.catalog }));
vi.mock('@/features/resources/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/resources/service')>(),
  createResourceService: vi.fn(() => mocks.resources),
}));
vi.mock('@/features/opportunities/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/opportunities/service')>(),
  createOpportunityService: vi.fn(() => mocks.opportunities),
}));
// The stub reports the engine frame depth so the detail pages can prove engine blocks render flat.
vi.mock('@/features/ecosystem/ui/StaticRichContent', async () => {
  const { useFrameDepth } = await import('@/content-engine/render/render-context');
  return { StaticRichContent: () => <div data-testid="rich-body" data-depth={useFrameDepth()}>Rich body</div> };
});
vi.mock('@/features/opportunities/ui/OpportunityActions', () => ({
  OpportunityViewTracker: () => null,
  OpportunityAction: () => <button type="button">Apply now</button>,
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const value = `${namespace}.${key}`.split('.').reduce<unknown>((part, segment) => (
      typeof part === 'object' && part !== null ? (part as Record<string, unknown>)[segment] : undefined
    ), en);
    return typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? '')) : key;
  }),
}));

import ResourcesPage from '@/app/app/resources/page';
import ResourceDetailPage from '@/app/app/resources/[id]/page';
import OpportunitiesPage from '@/app/app/opportunities/page';
import OpportunityDetailPage from '@/app/app/opportunities/[id]/page';

// Page-owned breadcrumbs read common.breadcrumbs through next-intl, so pages render inside a provider.
const render = (ui: ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);

beforeEach(() => {
  mocks.resources.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  mocks.opportunities.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  mocks.push.mockReset();
  window.history.replaceState({}, '', '/');
  mocks.catalog.mockResolvedValue([
    { id: 'required-course', title: 'Foundations of research' },
    { id: 'recommended-course', title: 'Research practice' },
  ]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('refined learner discovery', () => {
  it('offers one-click removal of a resource filter while preserving the other filters', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({ type: 'guide', search: 'robot', page: '2' }) }));
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getByRole('link', { name: 'Remove filter Guide' })).toHaveAttribute('href', '/app/resources?search=robot&page=1');
    expect(within(chips).getByRole('link', { name: 'Remove filter Search resources: robot' })).toHaveAttribute('href', '/app/resources?type=guide&page=1');
    expect(screen.getByRole('form', { name: 'Resource filters' })).toBeInTheDocument();
  });

  it('gives filtered empty resource results a clear action', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({ type: 'guide' }) }));
    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent('No resources match these filters.');
    expect(within(empty).getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/app/resources');
  });

  it('hands focus to the results header after the empty-state Clear remounts the page', async () => {
    window.history.replaceState({}, '', '/app/resources?type=guide');
    render(await ResourcesPage({ searchParams: Promise.resolve({ type: 'guide' }) }));
    const clear = within(screen.getByRole('status')).getByRole('link', { name: 'Clear filters' });
    // Stop jsdom's own navigation after the app's click handlers have run.
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('click', stopNavigation);
    fireEvent.click(clear);
    window.removeEventListener('click', stopNavigation);
    cleanup();
    window.history.replaceState({}, '', '/app/resources');
    render(await ResourcesPage({ searchParams: Promise.resolve({}) }));
    expect(document.activeElement).toBe(document.getElementById('resource-results'));
  });

  it('distinguishes an empty library from a filtered miss', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({}) }));
    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent('No resources have been published yet.');
    expect(within(empty).queryByRole('link')).not.toBeInTheDocument();
    // The page has no row h2s here, so the state title takes that level (no h1 -> h3 skip).
    expect(within(empty).getByRole('heading', { level: 2, name: 'No resources have been published yet.' })).toBeInTheDocument();
  });

  it('renders one link per resource row with its type, summary and pathway and tag meta', async () => {
    mocks.resources.listPage.mockResolvedValueOnce({
      items: [
        { id: 'guide-1', title: 'Guide one', summary: 'A useful guide', resourceType: 'guide', tags: ['research', 'ai'], skills: [], pathways: ['research-innovation'], body: { blocks: [] }, attachments: [], publishedAt: null },
        { id: 'tool-1', title: 'Tool one', summary: 'A tool', resourceType: 'tool', tags: [], skills: [], pathways: [], body: { blocks: [] }, attachments: [], publishedAt: null },
      ],
      total: 2, page: 1, pageSize: 50,
    });
    render(await ResourcesPage({ searchParams: Promise.resolve({ search: 'guide' }) }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(within(rows[0]).getByRole('link')).toHaveAccessibleName('Open Guide one');
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/app/resources/guide-1?search=guide');
    expect(within(rows[0]).getByRole('heading', { level: 2, name: 'Guide one' })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Guide');
    expect(rows[0]).toHaveTextContent('A useful guide');
    expect(rows[0]).toHaveTextContent('Research & innovation · #research #ai');
    expect(document.getElementById('resource-results')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps opportunity list context on its row link and shows the available action state', async () => {
    mocks.opportunities.listPage.mockResolvedValueOnce({
      items: [{ id: 'program-1', title: 'Research program', organization: 'VFuture', type: 'research_cohort', openAt: null, closeAt: null, featured: true, location: 'Hanoi', online: true }],
      total: 1, page: 1, pageSize: 50,
    });
    render(await OpportunitiesPage({ searchParams: Promise.resolve({ type: 'research_cohort', featured: 'true' }) }));
    expect(screen.getByRole('link', { name: 'View Research program' })).toHaveAttribute('href', '/app/opportunities/program-1?type=research_cohort&featured=true');
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Featured only' })).toBeChecked();
  });

  it('shows online location once on opportunity rows and detail', async () => {
    mocks.opportunities.listPage.mockResolvedValueOnce({
      items: [{ id: 'online-1', title: 'Online workshop', organization: 'VFuture', type: 'workshop', openAt: null, closeAt: null, featured: false, location: 'Online', online: true }],
      total: 1, page: 1, pageSize: 50,
    });
    const list = render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('table').querySelector('.vf-l-row-meta')).toHaveTextContent(/^VFuture · Online$/);
    list.unmount();

    mocks.opportunities.get.mockResolvedValueOnce({
      id: 'online-1', title: 'Online workshop', organization: 'VFuture', type: 'workshop',
      description: { blocks: [] }, eligibility: {}, recommendedSkills: [],
      recommendedCourses: [], requiredCourses: [], applicationUrl: null, internalApplication: true,
      openAt: null, closeAt: null, startAt: null, endAt: null,
      location: 'Online', online: true, featured: false, interested: false, courseStatuses: [],
    });
    render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'online-1' }) }));
    expect(screen.getAllByText('Online')).toHaveLength(1);
    expect(screen.queryByText('Location: Online')).not.toBeInTheDocument();
  });

  it('keeps featured=false visible and treats its empty result as filtered', async () => {
    render(await OpportunitiesPage({ searchParams: Promise.resolve({ featured: 'false' }) }));
    expect(mocks.opportunities.listPage).toHaveBeenCalledWith({ featured: false }, expect.anything());
    expect(screen.queryByRole('combobox', { name: 'Featured' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Featured only' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Remove filter Not featured' })).toHaveAttribute('href', '/app/opportunities?page=1');
    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent('No opportunities match these filters.');
    expect(within(empty).getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/app/opportunities');
    expect(within(empty).getByRole('heading', { level: 2, name: 'No opportunities match these filters.' })).toBeInTheDocument();
  });

  it('carries featured=false through Apply, and a checked Featured only replaces it', async () => {
    const view = render(await OpportunitiesPage({ searchParams: Promise.resolve({ featured: 'false' }) }));
    const form = screen.getByRole('form', { name: 'Opportunity filters' });
    fireEvent.submit(form);
    expect(mocks.push).toHaveBeenLastCalledWith('/app/opportunities?featured=false');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Featured only' }));
    fireEvent.submit(form);
    expect(mocks.push).toHaveBeenLastCalledWith('/app/opportunities?featured=true');
    view.unmount();

    render(await OpportunitiesPage({ searchParams: Promise.resolve({ featured: 'true' }) }));
    expect(document.querySelector('input[type="hidden"][name="featured"]')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Featured only' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Opportunity filters' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/app/opportunities');
  });

  it('renders one link per opportunity row with the availability tone and an ICT closing day', async () => {
    const now = Date.now();
    const day = 86_400_000;
    mocks.opportunities.listPage.mockResolvedValueOnce({
      items: [
        { id: 'open-1', title: 'Open program', organization: 'VFuture', type: 'workshop', openAt: null, closeAt: '2099-12-31T18:30:00.000Z', featured: true, location: 'Hanoi', online: false },
        { id: 'soon-1', title: 'Upcoming program', organization: 'VFuture', type: 'event', openAt: new Date(now + 10 * day).toISOString(), closeAt: null, featured: false, location: null, online: true },
        { id: 'past-1', title: 'Closed program', organization: 'VFuture', type: 'hackathon', openAt: null, closeAt: new Date(now - 10 * day).toISOString(), featured: false, location: null, online: false },
      ],
      total: 3, page: 1, pageSize: 50,
    });
    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(within(row).getAllByRole('link')).toHaveLength(1);
    const tone = (row: HTMLElement, label: string) => within(row).getByText(label).closest('.vf-tag')?.getAttribute('data-tone') ?? null;
    expect(tone(rows[0], 'Open')).toBe('signal');
    expect(tone(rows[1], 'Upcoming')).toBe('pending');
    expect(tone(rows[2], 'Closed')).toBeNull();
    // 18:30 UTC on 31 Dec is already 1 Jan in Vietnam (UTC+7).
    expect(rows[0]).toHaveTextContent('VFuture · Hanoi · Closes 01.01.2100 ICT');
    expect(rows[1]).toHaveTextContent('VFuture · Online');
    expect(within(rows[0]).getByRole('link')).toHaveAccessibleName('View Open program');
  });

  it('shows readable course titles in an opportunity and preserves the back context', async () => {
    mocks.opportunities.get.mockResolvedValueOnce({
      id: 'program-1', title: 'Research program', organization: 'VFuture', type: 'research_cohort',
      description: { blocks: [] }, eligibility: {}, recommendedSkills: ['research'],
      recommendedCourses: ['recommended-course'], requiredCourses: ['required-course'],
      applicationUrl: 'https://example.com/apply', internalApplication: false,
      openAt: null, closeAt: null, startAt: null, endAt: null,
      location: 'Hanoi', online: true, featured: false, interested: false,
      courseStatuses: [{ courseId: 'required-course', status: 'active' }],
    });
    render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'program-1' }), searchParams: Promise.resolve({ type: 'research_cohort', page: '2' }) }));
    expect(screen.getByRole('link', { name: 'Foundations of research' })).toHaveAttribute('href', '/app/courses/required-course');
    expect(screen.getByRole('link', { name: 'Research practice' })).toHaveAttribute('href', '/app/courses/recommended-course');
    expect(screen.queryByText('Course required-course')).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('href', '/app/opportunities?type=research_cohort&page=2');
  });

  it('keeps resource detail attachments and list context reachable', async () => {
    mocks.resources.get.mockResolvedValueOnce({
      id: 'guide-1', title: 'Guide one', summary: 'A useful guide', resourceType: 'guide', tags: ['research'],
      skills: [], pathways: ['research-innovation'], body: { blocks: [] },
      attachments: [{ label: 'Worksheet', src: { url: 'https://example.com/worksheet' } }], publishedAt: null,
    });
    render(await ResourceDetailPage({ params: Promise.resolve({ id: 'guide-1' }), searchParams: Promise.resolve({ search: 'research', page: '2' }) }));
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/app/resources?search=research&page=2');
    expect(screen.getByRole('link', { name: 'Worksheet' })).toHaveAttribute('href', 'https://example.com/worksheet');
  });

  it('renders the resource body flat inside one card, with attachments and tags aside', async () => {
    mocks.resources.get.mockResolvedValueOnce({
      id: 'guide-1', title: 'Guide one', summary: 'A useful guide', resourceType: 'guide', tags: ['research'],
      skills: [], pathways: [], body: { blocks: [{ type: 'paragraph', text: 'x' }] },
      attachments: [{ label: 'Worksheet', src: { assetId: 'asset-1' } }], publishedAt: null,
    });
    const { container } = render(await ResourceDetailPage({ params: Promise.resolve({ id: 'guide-1' }) }));

    const body = screen.getByTestId('rich-body');
    expect(body).toHaveAttribute('data-depth', '1');
    expect(body.closest('.vf-card')).not.toBeNull();
    expect(container.querySelector('.vf-card .vf-card')).toBeNull();
    const aside = container.querySelector('aside[data-area="aside"]') as HTMLElement;
    expect(within(aside).getByRole('link', { name: 'Worksheet' })).toHaveAttribute('href', '/api/v1/media/asset-1');
    expect(within(aside).getByText('research')).toHaveClass('vf-tag');
    expect(container.querySelector('.vf-l-detail')).toHaveAttribute('data-aside');
  });

  it('drops the aside when a resource has no attachments or tags', async () => {
    mocks.resources.get.mockResolvedValueOnce({
      id: 'guide-2', title: 'Guide two', summary: 'Plain', resourceType: 'guide', tags: [],
      skills: [], pathways: [], body: { blocks: [] }, attachments: [], publishedAt: null,
    });
    const { container } = render(await ResourceDetailPage({ params: Promise.resolve({ id: 'guide-2' }) }));

    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('[data-area="action"]')).toBeNull();
    expect(container.querySelector('.vf-l-detail')).not.toHaveAttribute('data-aside');
  });
});

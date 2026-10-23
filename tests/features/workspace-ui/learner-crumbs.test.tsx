// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const messages = withBenchMessages(en, 'en');
const mocks = vi.hoisted(() => ({
  pathname: '/app',
  listCatalog: vi.fn(),
  getCourse: vi.fn(),
  resources: { listPage: vi.fn(), get: vi.fn() },
  opportunities: { listPage: vi.fn(), get: vi.fn() },
  listProjects: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(() => { throw new Error('not_found'); }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace?: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never })),
}));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})), supabaseUser: vi.fn() }));
vi.mock('@/features/ecosystem/context', () => ({ learnerContext: vi.fn(async () => ({ userId: 'learner-1', branchId: null, locale: 'en' })) }));
vi.mock('@/features/catalog/service', () => ({ listCatalog: mocks.listCatalog, getCourse: mocks.getCourse }));
vi.mock('@/features/resources/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/resources/service')>(),
  createResourceService: vi.fn(() => mocks.resources),
}));
vi.mock('@/features/opportunities/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/opportunities/service')>(),
  createOpportunityService: vi.fn(() => mocks.opportunities),
}));
vi.mock('@/features/projects/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/projects/service')>(),
  listProjects: mocks.listProjects,
  getProject: mocks.getProject,
}));
vi.mock('@/features/ecosystem/ui/StaticRichContent', () => ({ StaticRichContent: () => <div>Rich body</div> }));
vi.mock('@/features/opportunities/ui/OpportunityActions', () => ({ OpportunityViewTracker: () => null, OpportunityAction: () => <button type="button">Apply now</button> }));
vi.mock('@/features/learner/ui/EnrollButton', () => ({ EnrollButton: () => <button type="button">Enroll</button> }));

import { AppShell } from '@/components/AppShell';
import LearnerCatalogPage from '@/app/app/courses/page';
import LearnerCoursePage from '@/app/app/courses/[courseId]/page';
import ExplorePage from '@/app/app/explore/page';
import OpportunitiesPage from '@/app/app/opportunities/page';
import OpportunityDetailPage from '@/app/app/opportunities/[id]/page';
import BuildPage from '@/app/app/projects/page';
import BuildDetailPage from '@/app/app/projects/[id]/page';
import ResourcesPage from '@/app/app/resources/page';
import ResourceDetailPage from '@/app/app/resources/[id]/page';
import { LearnerDashboardView } from '@/features/workspace-ui/learner/LearnerDashboardView';
import { PageSkeleton } from '@/features/workspace-ui/ui/BenchState';

const OWNER = '00000000-0000-4000-8000-000000000001';
const project = {
  id: 'climate-lab', title: { vi: 'Khí hậu', en: 'Climate lab' }, summary: { vi: 'Dự án', en: 'Climate project' }, status: 'active' as const,
  outputLinks: [], skills: [], courseIds: [], ownerId: OWNER, coverAssetId: null, approved: true, branchScope: { scope: 'global' as const },
  createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', viewerRole: null, relationship: 'showcase' as const,
};

beforeEach(() => {
  mocks.listCatalog.mockResolvedValue([]);
  mocks.getCourse.mockResolvedValue({
    id: 'ai', meta: { title: 'AI Foundations', summary: 'Start here.', pathway: 'ai-emerging-technology', learningOutcomes: [] },
    enrollment: null, skills: [], completion: { requirements: [] }, progress: { completedItems: 0, totalItems: 0 }, outline: { modules: [] },
  });
  mocks.resources.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  mocks.resources.get.mockResolvedValue({ id: 'guide-1', title: 'Guide one', summary: 'A guide', resourceType: 'guide', tags: [], skills: [], pathways: [], body: { blocks: [] }, attachments: [], publishedAt: null });
  mocks.opportunities.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  mocks.opportunities.get.mockResolvedValue({
    id: 'program-1', title: 'Research program', organization: 'VFuture', type: 'research_cohort', description: { blocks: [] }, eligibility: {},
    recommendedSkills: [], recommendedCourses: [], requiredCourses: [], applicationUrl: null, internalApplication: true,
    openAt: null, closeAt: null, startAt: null, endAt: null, location: null, online: true, featured: false, interested: false, courseStatuses: [],
  });
  mocks.listProjects.mockResolvedValue([project]);
  mocks.getProject.mockResolvedValue({ ...project, members: [], relatedCourses: [], interested: false, canExpressInterest: false, interestList: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const shell = (pathname: string, page: ReactNode) => {
  mocks.pathname = pathname;
  return render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh"><AppShell>{page}</AppShell></NextIntlClientProvider>);
};
const crumbs = () => screen.queryAllByRole('navigation', { name: en.common.breadcrumbs });
const searchParams = (query: Record<string, string> = {}) => Promise.resolve(query);

describe('page-owned breadcrumbs', () => {
  it.each([
    ['/app/resources', () => ResourcesPage({ searchParams: searchParams() }), ['Explore', 'Resources']],
    ['/app/resources/guide-1', () => ResourceDetailPage({ params: Promise.resolve({ id: 'guide-1' }), searchParams: searchParams({ type: 'guide' }) }), ['Explore', 'Resources', 'Guide one']],
    ['/app/opportunities', () => OpportunitiesPage({ searchParams: searchParams() }), ['Explore', 'Opportunities']],
    ['/app/opportunities/program-1', () => OpportunityDetailPage({ params: Promise.resolve({ id: 'program-1' }), searchParams: searchParams() }), ['Explore', 'Opportunities', 'Research program']],
    ['/app/projects', () => BuildPage({ searchParams: searchParams() }), ['Explore', 'Projects']],
    ['/app/projects/climate-lab', () => BuildDetailPage({ params: Promise.resolve({ id: 'climate-lab' }), searchParams: searchParams() }), ['Explore', 'Projects', 'Climate lab']],
    ['/app/courses/ai', () => LearnerCoursePage({ params: Promise.resolve({ courseId: 'ai' }), searchParams: searchParams({ tab: 'discover' }) }), ['Courses', 'AI Foundations']],
  ] as const)('renders exactly one breadcrumbs nav on %s', async (pathname, page, trail) => {
    shell(pathname, await page());
    const navs = crumbs();
    expect(navs).toHaveLength(1);
    expect(navs[0].closest('main')).toBeInTheDocument();
    expect(within(navs[0]).getAllByRole('listitem').map(item => item.textContent?.replace('/', '').trim())).toEqual(trail);
    expect(within(navs[0]).getByText(trail[trail.length - 1])).toHaveAttribute('aria-current', 'page');
    if (trail[0] === 'Explore') expect(within(navs[0]).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/app/explore');
  });

  it('carries the normalized list query in the section crumb of a detail page', async () => {
    shell('/app/resources/guide-1', await ResourceDetailPage({ params: Promise.resolve({ id: 'guide-1' }), searchParams: searchParams({ type: 'guide', pathway: 'invalid', page: '2' }) }));
    expect(within(crumbs()[0]).getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/app/resources?type=guide&page=2');
  });

  it('renders no breadcrumbs on /app/explore, /app/courses or the dashboard', async () => {
    const explore = shell('/app/explore', await ExplorePage());
    expect(crumbs()).toHaveLength(0);
    explore.unmount();
    const catalog = shell('/app/courses', await LearnerCatalogPage({ searchParams: searchParams() }));
    expect(crumbs()).toHaveLength(0);
    catalog.unmount();
    shell('/app', <LearnerDashboardView data={{ now: new Date('2026-09-24T14:14:00Z'), name: 'Avery', state: 'first-run', resume: null, courses: [], exam: null, feedback: null, completion: null }} trace={<p>trace</p>} readout={<p>readout</p>} />);
    expect(crumbs()).toHaveLength(0);
  });
});

describe('route-change focus', () => {
  it('moves focus to the page h1 once it replaces the route skeleton', async () => {
    mocks.pathname = '/app/resources';
    const provider = (children: ReactNode) => <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh"><AppShell>{children}</AppShell></NextIntlClientProvider>;
    const view = render(provider(<PageSkeleton variant="directory" label="Loading" />));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement?.tagName).not.toBe('H1');
    view.rerender(provider(<h1>Resources</h1>));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Resources' })).toHaveFocus());
  });
});

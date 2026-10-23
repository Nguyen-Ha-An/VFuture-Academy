// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render as rtlRender, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), listPage: vi.fn(), redirect: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn().mockResolvedValue('en'),
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, unknown>) => (
    key === 'course' ? `Course ${values?.id}` : key
  )),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('not_found'); }),
  redirect: mocks.redirect,
  usePathname: () => '/app/opportunities',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn().mockResolvedValue({ id: 'learner-1' }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/catalog/service', () => ({ listCatalog: vi.fn().mockResolvedValue([{ id: 'required-course', title: 'Required course', skills: [] }]) }));
vi.mock('@/features/ecosystem/context', () => ({ learnerContext: vi.fn().mockResolvedValue({ userId: 'learner-1', branchId: 'branch-one', locale: 'en' }) }));
vi.mock('@/features/ecosystem/ui/StaticRichContent', () => ({ StaticRichContent: () => <div>Opportunity description</div> }));
vi.mock('@/features/opportunities/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/opportunities/service')>(),
  createOpportunityService: vi.fn(() => ({ get: mocks.get, listPage: mocks.listPage })),
}));
vi.mock('@/features/opportunities/ui/OpportunityActions', () => ({
  OpportunityViewTracker: () => null,
  OpportunityAction: ({ availability, eligible }: { availability: string; eligible: boolean }) => (
    <output data-testid="opportunity-action">{`${availability}:${eligible}`}</output>
  ),
}));

import OpportunityDetailPage from '@/app/app/opportunities/[id]/page';
import OpportunitiesPage from '@/app/app/opportunities/page';

// Page-owned breadcrumbs read common.breadcrumbs through next-intl, so pages render inside a provider.
const render = (ui: ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);

beforeEach(() => {
  mocks.get.mockResolvedValue({
    id: 'research-cohort', title: 'Research cohort', organization: 'VFuture', type: 'research_cohort',
    description: { blocks: [] }, eligibility: { 'Minimum age': 16 }, recommendedSkills: [],
    recommendedCourses: ['recommended-course'], requiredCourses: ['required-course'],
    applicationUrl: 'https://example.com/apply', internalApplication: false,
    openAt: '2020-01-01T00:00:00.000Z', closeAt: '2099-12-31T23:59:59.999Z',
    startAt: '2027-01-10T02:00:00.000Z', endAt: '2027-02-10T02:00:00.000Z',
    location: 'Ho Chi Minh City', online: true, featured: true, interested: false,
    courseStatuses: [{ courseId: 'recommended-course', status: 'completed' }, { courseId: 'required-course', status: 'active' }],
  });
});

afterEach(cleanup);

describe('learner opportunity detail', () => {
  it('shows availability, all dates, eligibility details, and authenticated course destinations', async () => {
    render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'research-cohort' }) }));

    expect(screen.getByText('availability.open')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'dates' })).toBeInTheDocument();
    expect(screen.getByText('dateLabels.openAt')).toBeInTheDocument();
    expect(screen.getByText('dateLabels.closeAt')).toBeInTheDocument();
    expect(screen.getByText('dateLabels.startAt')).toBeInTheDocument();
    expect(screen.getByText('dateLabels.endAt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'eligibility' })).toBeInTheDocument();
    // The authored "Minimum age" key maps to the labelled minAge key.
    expect(screen.getByText('eligibilityKeys.minAge')).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('ineligible')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Required course' })).toHaveAttribute('href', '/app/courses/required-course');
    expect(screen.getByTestId('opportunity-action')).toHaveTextContent('open:false');
  });

  it('shows the type and availability as tags, ICT mono dates and the action panel "Next step"', async () => {
    const { container } = render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'research-cohort' }) }));

    const head = container.querySelector('.vf-page-head') as HTMLElement;
    expect(within(head).getByText('types.research_cohort')).toHaveClass('vf-tag');
    expect(within(head).getByText('availability.open')).toHaveClass('vf-tag');
    // Same tones as the list: open is the signal.
    expect(within(head).getByText('availability.open')).toHaveAttribute('data-tone', 'signal');
    // 2027-01-10T02:00Z is 09:00 in Ho Chi Minh City.
    expect(screen.getByText('10.01.2027 09:00 ICT')).toHaveAttribute('dateTime', '2027-01-10T02:00:00.000Z');
    const action = container.querySelector('[data-area="action"]') as HTMLElement;
    expect(within(action).getByRole('heading', { name: 'nextStep' })).toBeInTheDocument();
    expect(within(action).getByTestId('opportunity-action')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Required course' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'requiredCourses' })).getByText('courseStatuses.active')).toHaveClass('vf-tag');
  });

  it('renders the eligibility note as prose, labels known keys and hides unknown keys', async () => {
    mocks.get.mockResolvedValueOnce({
      ...await mocks.get(),
      eligibility: { note: 'Bring a laptop.', grade: '10-12', internalScore: 42, secretFlag: true },
    });
    render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'research-cohort' }) }));

    const eligibility = screen.getByRole('region', { name: 'eligibility' });
    expect(within(eligibility).getByText('Bring a laptop.').tagName).toBe('P');
    expect(within(eligibility).getByText('eligibilityKeys.grade')).toBeInTheDocument();
    expect(within(eligibility).getByText('10-12')).toBeInTheDocument();
    expect(within(eligibility).queryByText(/internalScore|secretFlag|42/)).toBeNull();
    expect(within(eligibility).queryByText('noAdditionalEligibility')).toBeNull();
  });

  it('falls back to "no additional eligibility" when only unknown keys exist', async () => {
    mocks.get.mockResolvedValueOnce({ ...await mocks.get(), eligibility: { internalScore: 42 } });
    render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'research-cohort' }) }));

    const eligibility = screen.getByRole('region', { name: 'eligibility' });
    expect(within(eligibility).getByText('noAdditionalEligibility')).toBeInTheDocument();
    expect(within(eligibility).queryByText(/internalScore/)).toBeNull();
  });

  it('names recommended skills from the catalog or a readable id, and never nests a card in a card', async () => {
    mocks.get.mockResolvedValueOnce({ ...await mocks.get(), recommendedSkills: ['data-literacy'] });
    const { container } = render(await OpportunityDetailPage({ params: Promise.resolve({ id: 'research-cohort' }) }));

    expect(screen.getByText('Data literacy')).toHaveClass('vf-tag');
    expect(screen.queryByText('data-literacy')).toBeNull();
    expect(container.querySelector('.vf-card .vf-card')).toBeNull();
  });
});

describe('learner opportunity list', () => {
  it('renders reachable filter-preserving pagination after the first 50 rows', async () => {
    mocks.listPage.mockResolvedValue({ items: [{ id: 'hackathon-1', title: 'Hackathon', organization: 'VFuture', type: 'hackathon', openAt: null, closeAt: null, featured: true, location: null }], total: 120, page: 2, pageSize: 50 });

    render(await OpportunitiesPage({ searchParams: Promise.resolve({
      type: 'hackathon', openNow: 'true', featured: 'true', page: '2',
    }) }));

    const pager = screen.getByRole('navigation', { name: 'Result pages' });
    expect(pager).toHaveTextContent('Page 2 of 3');
    const previous = within(pager).getByRole('link', { name: 'Previous' });
    const next = within(pager).getByRole('link', { name: 'Next' });
    expect(previous.getAttribute('href')).toContain('type=hackathon');
    expect(previous.getAttribute('href')).toContain('openNow=true');
    expect(previous.getAttribute('href')).toContain('page=1');
    expect(next.getAttribute('href')).toContain('page=3');
    expect(screen.getByRole('link', { name: 'View Hackathon' })).toHaveAttribute('href', '/app/opportunities/hackathon-1?type=hackathon&openNow=true&featured=true&page=2');
  });

  it('marks featured rows with a mono "Featured" meta item and matches the detail tones', async () => {
    mocks.listPage.mockResolvedValue({ items: [
      { id: 'featured-1', title: 'Featured lab', organization: 'VFuture', type: 'hackathon', openAt: '2099-01-01T00:00:00.000Z', closeAt: null, featured: true, location: null },
      { id: 'plain-1', title: 'Plain lab', organization: 'VFuture', type: 'hackathon', openAt: null, closeAt: '2000-01-01T00:00:00.000Z', featured: false, location: null },
    ], total: 2, page: 1, pageSize: 50 });

    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }));

    const [featuredRow, plainRow] = screen.getAllByRole('row').slice(1);
    const featuredMeta = featuredRow.querySelector('.vf-l-row-meta') as HTMLElement;
    expect(featuredMeta).toHaveClass('vf-meta');
    expect(featuredMeta).toHaveTextContent(/^featured · VFuture/);
    expect(plainRow.querySelector('.vf-l-row-meta')).not.toHaveTextContent('featured');
    expect(within(featuredRow).getByText('availability.upcoming')).toHaveAttribute('data-tone', 'pending');
    expect(within(plainRow).getByText('availability.closed')).not.toHaveAttribute('data-tone');
  });

  it('drops only the invalid key from the detail back link', async () => {
    render(await OpportunityDetailPage({
      params: Promise.resolve({ id: 'research-cohort' }),
      searchParams: Promise.resolve({ type: 'hackathon', openNow: 'true', featured: 'invalid', page: '2' }),
    } as Parameters<typeof OpportunityDetailPage>[0]));

    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('href', '/app/opportunities?type=hackathon&openNow=true&page=2');
  });

  it('keeps the other filters when "any" options submit empty params (F1)', async () => {
    mocks.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    render(await OpportunitiesPage({ searchParams: Promise.resolve({ type: '', openNow: 'true', featured: '' }) }));

    expect(mocks.listPage).toHaveBeenLastCalledWith({ openNow: true }, expect.anything());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('canonicalizes an out-of-range page while retaining valid filters', async () => {
    mocks.listPage.mockResolvedValue({ items: [], total: 1, page: 99, pageSize: 50 });
    mocks.redirect.mockImplementationOnce((href: string) => { throw new Error(`redirect:${href}`); });

    await expect(OpportunitiesPage({ searchParams: Promise.resolve({
      type: 'hackathon', openNow: 'true', page: '99',
    }) })).rejects.toThrow('redirect:/app/opportunities?type=hackathon&openNow=true&page=1');
  });
});

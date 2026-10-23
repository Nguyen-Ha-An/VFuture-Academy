// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'vi', query: '', push: vi.fn(),
  listPublicCourses: vi.fn(), getPublicCourse: vi.fn(), listPublicOpportunitiesByIds: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://vfuture.example' } }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    if (namespace === 'marketing.metadata') {
      const messages = mocks.locale === 'en' ? en : viMessages;
      return messages.marketing.metadata[key as keyof typeof messages.marketing.metadata];
    }
    return values ? `${key}:${Object.values(values).join(':')}` : key;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }), usePathname: () => '/courses', useSearchParams: () => new URLSearchParams(mocks.query),
  notFound: () => { throw new Error('not_found'); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
}));
vi.mock('@/features/marketing/public-courses', () => ({
  listPublicCourses: mocks.listPublicCourses, getPublicCourse: mocks.getPublicCourse, listPublicOpportunitiesByIds: mocks.listPublicOpportunitiesByIds,
}));
// Sticky visibility has its own browser contract; this suite checks the original action.
vi.mock('@/features/public-site/PublicStickyAction', () => ({ PublicStickyAction: () => null }));
// React DOM does not render async server children; the real breadcrumb links are covered by navigation tests.
vi.mock('@/features/public-site/PublicPrimitives', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/public-site/PublicPrimitives')>(),
  PublicBreadcrumbs: () => null,
}));

import CoursesPage, { generateMetadata as generateCoursesMetadata } from '@/app/(public)/courses/page';
import PublicCoursePage, { generateMetadata as generateCourseMetadata } from '@/app/(public)/courses/[courseId]/page';
import { AcademyGateway } from '@/features/public-site/academy/AcademyGateway';
import { PATHWAYS } from '@/content-engine';

const course = {
  id: 'course-one', slug: 'course-one', title: 'Public course title', summary: 'A public description.',
  pathway: 'ai-emerging-technology', level: 'foundation', difficulty: 'beginner', skills: [],
  learningOutcomes: ['Explain the public concept.'], relatedOpportunityIds: ['public-opportunity'],
  modules: [{ id: 'module-one', title: 'Public module', items: [{ id: 'private-lesson', type: 'lesson', title: 'Public lesson title', required: true, body: 'PRIVATE LESSON CONTENT MUST NOT APPEAR' }] }],
};

function show(node: ReactNode, locale: 'en' | 'vi' = 'en') {
  return render(<NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : viMessages}>{node}</NextIntlClientProvider>);
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.query = '';
  mocks.getPublicCourse.mockResolvedValue(course);
  mocks.listPublicOpportunitiesByIds.mockResolvedValue([{ id: 'public-opportunity', title: 'Public opportunity', summary: 'Published summary.' }]);
});

describe('public learning navigation and projection', () => {
  it.each(['en', 'vi'] as const)('uses one brand in the %s catalog title', async (locale) => {
    mocks.locale = locale;
    const metadata = await generateCoursesMetadata();
    const title = (locale === 'en' ? en : viMessages).marketing.metadata.catalogTitle;
    expect(metadata.title).toEqual({ absolute: `${title} | VFuture Academy` });
  });

  it('uses the public course title with one site brand', async () => {
    const metadata = await generateCourseMetadata({ params: Promise.resolve({ courseId: course.id }) });
    expect(metadata.title).toEqual({ absolute: 'Public course title | VFuture Academy' });
  });

  it('keeps the 500-course request, native pathway form and 12-item paging contract', async () => {
    mocks.query = 'pathway=ai-emerging-technology&page=2&lang=en';
    mocks.listPublicCourses.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({ ...course, id: `course-${index + 1}`, title: `Course ${index + 1}` })));
    const { container } = show(await CoursesPage({ searchParams: Promise.resolve({ pathway: course.pathway, page: '2' }) }));
    expect(mocks.listPublicCourses).toHaveBeenCalledWith('en', { limit: 500 });
    const form = screen.getByRole('form', { name: 'catalog.filterLabel' });
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/courses');
    expect(within(form).getAllByRole('option')).toHaveLength(PATHWAYS.length + 1);
    expect(container.querySelectorAll('.public-course-card')).toHaveLength(12);
    const link = within(screen.getByRole('heading', { level: 2, name: /Course 13/ })).getByRole('link');
    const href = new URL(link.getAttribute('href')!, 'https://vfuture.example');
    expect(href.pathname).toBe('/courses/course-13');
    expect(Object.fromEntries(href.searchParams)).toEqual({ pathway: course.pathway, page: '2', lang: 'en' });
  });

  it.each([25, 0])('redirects out-of-range course pages to the resolved page while keeping context (%i courses)', async (total) => {
    mocks.listPublicCourses.mockResolvedValue(Array.from({ length: total }, (_, index) => ({ ...course, id: `course-${index + 1}` })));
    const page = Math.max(1, Math.ceil(total / 12));
    await expect(CoursesPage({ searchParams: Promise.resolve({ pathway: course.pathway, page: '999' }) }))
      .rejects.toThrow(`redirect:/courses?pathway=${course.pathway}&page=${page}&lang=en`);
  });

  it('keeps public outline metadata visible and protected content behind the exact learner action', async () => {
    const { container } = show(await PublicCoursePage({ params: Promise.resolve({ courseId: course.id }), searchParams: Promise.resolve({ pathway: course.pathway, page: '2', returnTo: 'https://evil.example' }) }));
    expect(screen.getByText('Public module')).toBeTruthy();
    expect(screen.getByText('Public lesson title')).toBeTruthy();
    expect(screen.getByText('Explain the public concept.')).toBeTruthy();
    expect(container.textContent).not.toContain('PRIVATE LESSON CONTENT MUST NOT APPEAR');
    expect(container.querySelector('a[href*="private-lesson"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'course.continueToCourse' }).getAttribute('href')).toBe('/app/courses/course-one');
    const back = new URL(screen.getByRole('link', { name: 'course.back' }).getAttribute('href')!, 'https://vfuture.example');
    expect(Object.fromEntries(back.searchParams)).toEqual({ pathway: course.pathway, page: '2', lang: 'en' });
    expect(mocks.listPublicOpportunitiesByIds).toHaveBeenCalledWith('en', ['public-opportunity']);
    expect(screen.getByRole('link', { name: 'Public opportunity' }).getAttribute('href')).toBe('/opportunities/public-opportunity?lang=en');
  });

  it.each(['en', 'vi'] as const)('keeps all Academy field destinations and account routes correct in %s', async locale => {
    mocks.locale = locale;
    const messages = locale === 'en' ? en : viMessages;
    const user = userEvent.setup();
    const { container } = show(<AcademyGateway fields={PATHWAYS} />, locale);
    expect(screen.getByRole('heading', { level: 1, name: `${messages.academyGateway.hero.titleLead} ${messages.academyGateway.hero.titleEmphasis}` })).toBeTruthy();
    expect(screen.getByRole('link', { name: messages.academyGateway.hero.browseCourses }).getAttribute('href')).toBe(`/courses?lang=${locale}`);
    expect(screen.getByRole('link', { name: messages.academyGateway.hero.signIn }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: messages.academyGateway.hero.createAccount }).getAttribute('href')).toBe('/signup');
    const research = messages.marketing.pathways.items.researchInnovation.name;
    await user.click(screen.getByRole('button', { name: research }));
    expect(screen.getByRole('link', { name: `${messages.labs.academy.explorer.cta}: ${research}` }).getAttribute('href')).toBe(`/courses?pathway=research-innovation&lang=${locale}`);
    expect(container.querySelector(`a[href="/projects?lang=${locale}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/resources?lang=${locale}"]`)).not.toBeNull();
    expect(container.querySelectorAll('details > summary')).toHaveLength(5);
  });
});

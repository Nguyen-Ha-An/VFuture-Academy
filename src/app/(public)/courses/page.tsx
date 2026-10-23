import type { Metadata } from 'next';
import { PATHWAYS, type Locale } from '@/content-engine';
import { pathwayKeys } from '@/features/marketing/catalog-labels';
import { PublicCourseCard } from '@/features/public-site/PublicCourseCard';
import { PublicCatalogPage, PublicEmptyState, PublicPageHeader, PublicPagination } from '@/features/public-site/PublicPrimitives';
import { PublicFilterForm, PublicLink } from '@/features/public-site/PublicNavigation';
import { publicDetailHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { buildPublicMetadata } from '@/features/public-site/metadata';
import { learningCopy } from '@/features/public-site/public-learning-copy';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-learning.css';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata>;
export function generateMetadata(props: { searchParams?: Promise<PublicSearchParams> }): Promise<Metadata>;
export async function generateMetadata({ searchParams }: { searchParams?: Promise<PublicSearchParams> } = {}): Promise<Metadata> {
  const { getLocale, getTranslations } = await import('next-intl/server');
  const [locale, t, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('marketing.metadata'), searchParams ?? Promise.resolve({} as PublicSearchParams)]);
  return buildPublicMetadata({ title: t('catalogTitle'), description: t('catalogDescription'), pathname: '/courses', locale, page: Number(params.page), filtered: Boolean(params.pathway) });
}

export default async function CoursesPage({ searchParams }: { searchParams: Promise<PublicSearchParams> }) {
  const [{ getLocale, getTranslations }, { listPublicCourses }] = await Promise.all([import('next-intl/server'), import('@/features/marketing/public-courses')]);
  const [locale, t, pagination, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('marketing'), getTranslations('publicDiscovery'), searchParams]);
  const copy = learningCopy[locale];
  const selectedPathway = typeof params.pathway === 'string' && PATHWAYS.includes(params.pathway as (typeof PATHWAYS)[number]) ? params.pathway : undefined;
  const courses = await listPublicCourses(locale, { limit: 500 });
  const visibleCourses = selectedPathway ? courses.filter(course => course.pathway === selectedPathway) : courses;
  const requestedPage = Number(params.page);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(visibleCourses.length / pageSize));
  if (Number.isInteger(requestedPage) && requestedPage > totalPages) {
    const { redirect } = await import('next/navigation');
    redirect(publicHref('/courses', locale, {
      ...(selectedPathway ? { pathway: selectedPathway } : {}), page: String(totalPages),
    }));
  }
  const page = Math.min(Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, totalPages);
  const context = { ...(selectedPathway ? { pathway: selectedPathway } : {}), ...(page > 1 ? { page: String(page) } : {}) };
  const pageCourses = visibleCourses.slice((page - 1) * pageSize, page * pageSize);
  return (
    <PublicCatalogPage
      header={<PublicPageHeader eyebrow={t('catalog.eyebrow')} title={t('catalog.title')} description={t('catalog.description')} />}
      filters={<PublicFilterForm action="/courses" method="get" className="public-filter-form public-course-filters" aria-label={t('catalog.filterLabel')}>
        <label className="public-field"><span>{t('catalog.filterLabel')}</span><select name="pathway" defaultValue={selectedPathway ?? ''}><option value="">{t('catalog.allPathways')}</option>{PATHWAYS.map(pathway => <option key={pathway} value={pathway}>{t(pathwayKeys[pathway])}</option>)}</select></label>
        <button className="public-button" type="submit">{copy.apply}</button>
        {selectedPathway ? <PublicLink className="public-button public-button--secondary" href={publicHref('/courses', locale)} resultNavigation analytics={{ name: 'public.filters_applied', props: { route: 'courses', hasPathway: false } }}>{copy.reset}</PublicLink> : null}
      </PublicFilterForm>}
      summary={t('catalog.results', { count: visibleCourses.length })}
    >
      {pageCourses.length ? <div className="public-grid public-grid--two public-course-grid">{pageCourses.map((course, index) => <PublicCourseCard key={course.id} course={course} href={publicDetailHref('courses', course.id, context, locale)} position={(page - 1) * pageSize + index + 1} />)}</div> : <PublicEmptyState title={t('catalog.empty')} description={copy.emptyHint} resetHref={publicHref('/courses', locale)} resetLabel={copy.reset} />}
      <PublicPagination page={page} pageSize={pageSize} total={visibleCourses.length} query={{ ...(selectedPathway ? { pathway: selectedPathway } : {}), ...(locale === 'en' ? { lang: 'en' } : {}) }} href={routes.public.courses} labels={{ navigation: pagination('pagination.navigation'), previous: pagination('pagination.previous'), next: pagination('pagination.next'), summary: pagination('pagination.summary', { page, pages: totalPages }) }} />
    </PublicCatalogPage>
  );
}

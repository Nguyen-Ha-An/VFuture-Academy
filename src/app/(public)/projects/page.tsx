import type { Metadata } from 'next';
import type { Locale } from '@/content-engine';
import { PublicCatalogPage, PublicEmptyState, PublicPageHeader, PublicPagination } from '@/features/public-site/PublicPrimitives';
import { PublicFilterForm, PublicLink } from '@/features/public-site/PublicNavigation';
import { publicDetailHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { ProjectGalleryCard } from '@/features/public-site/public-discovery-cards';
import { discoveryCopy } from '@/features/public-site/public-discovery-copy';
import { buildPublicMetadata } from '@/features/public-site/metadata';
import { lastPublicPage } from '@/features/marketing/PublicDiscoveryPrimitives';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-discovery.css';

export const dynamic = 'force-dynamic';
const pageSize = 12;
const value = (input: string | string[] | undefined) => typeof input === 'string' ? input.trim() : '';
const positivePage = (input: string | string[] | undefined) => { const parsed = Number(value(input)); return Number.isInteger(parsed) && parsed > 0 ? parsed : 1; };
type Props = { searchParams: Promise<PublicSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { getLocale, getTranslations } = await import('next-intl/server');
  const [locale, t, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('build'), searchParams]);
  return buildPublicMetadata({ title: t('title'), description: t('description'), pathname: routes.public.projects(), locale, page: positivePage(params.page), filtered: Boolean(value(params.skill) || value(params.course)) });
}

export default async function PublicProjectsPage({ searchParams }: Props) {
  const [{ getLocale, getTranslations }, { listPublicProjects }, { listPublicCourses }] = await Promise.all([import('next-intl/server'), import('@/features/marketing/public-discovery'), import('@/features/marketing/public-courses')]);
  const [locale, t, common, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('build'), getTranslations('publicDiscovery'), searchParams]);
  const copy = discoveryCopy(locale);
  const filters = { ...(value(params.skill) ? { skill: value(params.skill) } : {}), ...(value(params.course) ? { course: value(params.course) } : {}), page: positivePage(params.page), pageSize };
  const [result, courses] = await Promise.all([listPublicProjects(locale, filters), listPublicCourses(locale, { limit: 500 })]);
  const hasUnavailableCourse = Boolean(filters.course && !courses.some(course => course.id === filters.course));
  const query = { ...(filters.skill ? { skill: filters.skill } : {}), ...(filters.course ? { course: filters.course } : {}), lang: locale };
  const lastPage = lastPublicPage(result.total, result.pageSize);
  if (filters.page > lastPage) {
    const { redirect } = await import('next/navigation');
    redirect(publicHref(routes.public.projects({ ...query, page: lastPage }), locale));
  }
  return <PublicCatalogPage
    header={<PublicPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />}
    filters={<PublicFilterForm method="get" action={routes.public.projects()} aria-label={t('filters.label')} className="public-filter-form discovery-filter-grid">
      <label className="public-field">{copy.skillFilter}<input name="skill" defaultValue={filters.skill} placeholder={t('filters.skillPlaceholder')} aria-describedby="project-skill-hint" /></label>
      <label className="public-field">{copy.courseFilter}<select name="course" defaultValue={filters.course ?? ''}><option value="">{copy.allCourses}</option>{hasUnavailableCourse ? <option value={filters.course}>{copy.unavailableCourse}</option> : null}{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      <button className="public-button">{t('filters.apply')}</button>
      {filters.skill || filters.course ? <PublicLink resultNavigation href={publicHref(routes.public.projects(), locale)} className="public-button public-button--secondary">{copy.reset}</PublicLink> : null}
      <p id="project-skill-hint" className="discovery-filter-hint">{copy.skillFilterHint}</p>
    </PublicFilterForm>}
    summary={t('results', { count: result.total })}>
    {result.items.length ? <div className="discovery-gallery">{result.items.map((item, position) => <ProjectGalleryCard key={item.id} item={item} href={publicDetailHref('projects', item.id, params, locale)} locale={locale} t={t} position={position} />)}</div> : <PublicEmptyState title={t('empty')} description={copy.emptyHint} resetHref={publicHref(routes.public.projects(), locale)} resetLabel={copy.reset} />}
    <PublicPagination page={result.page} pageSize={result.pageSize} total={result.total} query={query} href={routes.public.projects} labels={{ navigation: common('pagination.navigation'), previous: common('pagination.previous'), next: common('pagination.next'), summary: common('pagination.summary', { page: result.page, pages: lastPage }) }} />
  </PublicCatalogPage>;
}

import type { Metadata } from 'next';
import type { Locale } from '@/content-engine';
import { OPPORTUNITY_TYPES } from '@/features/opportunities/schema';
import { PublicCatalogPage, PublicEmptyState, PublicPageHeader, PublicPagination } from '@/features/public-site/PublicPrimitives';
import { PublicFilterForm, PublicLink } from '@/features/public-site/PublicNavigation';
import { publicDetailHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { OpportunityRow } from '@/features/public-site/public-discovery-cards';
import { discoveryCopy } from '@/features/public-site/public-discovery-copy';
import { buildPublicMetadata } from '@/features/public-site/metadata';
import { lastPublicPage } from '@/features/marketing/PublicDiscoveryPrimitives';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-discovery.css';

export const dynamic = 'force-dynamic';
const pageSize = 12;
const value = (input: string | string[] | undefined) => typeof input === 'string' ? input : '';
const positivePage = (input: string | string[] | undefined) => { const parsed = Number(value(input)); return Number.isInteger(parsed) && parsed > 0 ? parsed : 1; };
type Props = { searchParams: Promise<PublicSearchParams> };
const validType = (params: PublicSearchParams) => OPPORTUNITY_TYPES.includes(value(params.type) as (typeof OPPORTUNITY_TYPES)[number]);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { getLocale, getTranslations } = await import('next-intl/server');
  const [locale, t, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('opportunities'), searchParams]);
  return buildPublicMetadata({ title: t('title'), description: t('description'), pathname: routes.public.opportunities(), locale, page: positivePage(params.page), filtered: validType(params) || value(params.openNow) === 'true' || value(params.featured) === 'true' });
}

export default async function PublicOpportunitiesPage({ searchParams }: Props) {
  const [{ getLocale, getTranslations }, { listPublicOpportunities }] = await Promise.all([import('next-intl/server'), import('@/features/marketing/public-discovery')]);
  const [locale, t, common, params] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('opportunities'), getTranslations('publicDiscovery'), searchParams]);
  const copy = discoveryCopy(locale);
  const filters = { ...(validType(params) ? { type: value(params.type) as (typeof OPPORTUNITY_TYPES)[number] } : {}), ...(value(params.openNow) === 'true' ? { openNow: true } : {}), ...(value(params.featured) === 'true' ? { featured: true } : {}), page: positivePage(params.page), pageSize };
  const result = await listPublicOpportunities(locale, filters);
  const query = { ...(filters.type ? { type: filters.type } : {}), ...(filters.openNow ? { openNow: true } : {}), ...(filters.featured ? { featured: true } : {}), lang: locale };
  const lastPage = lastPublicPage(result.total, result.pageSize);
  if (filters.page > lastPage) {
    const { redirect } = await import('next/navigation');
    redirect(publicHref(routes.public.opportunities({ ...query, page: lastPage }), locale));
  }
  return <PublicCatalogPage
    header={<PublicPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />}
    filters={<PublicFilterForm method="get" action={routes.public.opportunities()} aria-label={copy.filterOpportunities} className="public-filter-form">

      <label className="public-field">{t('type')}<select name="type" defaultValue={filters.type ?? ''}><option value="">{t('allTypes')}</option>{OPPORTUNITY_TYPES.map(type => <option key={type} value={type}>{t(`types.${type}`)}</option>)}</select></label>
      <label className="discovery-filter-check"><input type="checkbox" name="openNow" value="true" defaultChecked={filters.openNow} />{t('openNow')}</label>
      <label className="discovery-filter-check"><input type="checkbox" name="featured" value="true" defaultChecked={filters.featured} />{t('featured')}</label>
      <button className="public-button">{t('filter')}</button>
      {filters.type || filters.openNow || filters.featured ? <PublicLink resultNavigation href={publicHref(routes.public.opportunities(), locale)} className="public-button public-button--secondary">{copy.reset}</PublicLink> : null}
    </PublicFilterForm>}
    summary={common('results', { count: result.total })}>
    {result.items.length ? <div className="discovery-opportunity-list">{result.items.map(item => <OpportunityRow key={item.id} item={item} href={publicDetailHref('opportunities', item.id, params, locale)} locale={locale} t={t} />)}</div> : <PublicEmptyState title={t('empty')} description={copy.emptyHint} resetHref={publicHref(routes.public.opportunities(), locale)} resetLabel={copy.reset} />}
    <PublicPagination page={result.page} pageSize={result.pageSize} total={result.total} query={query} href={routes.public.opportunities} labels={{ navigation: common('pagination.navigation'), previous: common('pagination.previous'), next: common('pagination.next'), summary: common('pagination.summary', { page: result.page, pages: lastPage }) }} />
  </PublicCatalogPage>;
}

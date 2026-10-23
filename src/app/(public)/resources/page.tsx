import type { Metadata } from 'next';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { RESOURCE_TYPES } from '@/content-engine/schema/bundle';
import { PATHWAYS } from '@/content-engine/schema/course';
import { PublicCatalogPage, PublicEmptyState, PublicPageHeader, PublicPagination } from '@/features/public-site/PublicPrimitives';
import { PublicFilterForm, PublicLink } from '@/features/public-site/PublicNavigation';
import { publicDetailHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { buildPublicMetadata } from '@/features/public-site/metadata';
import { publicResourcesCopy } from '@/features/public-site/public-resources-copy';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-resources.css';

export const dynamic = 'force-dynamic';
const pageSize = 12;
const value = (input: string | string[] | undefined) => typeof input === 'string' ? input.trim() : '';
const positivePage = (input: string | string[] | undefined) => {
  const parsed = Number(value(input));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

function resourceFilters(params: PublicSearchParams) {
  const type = value(params.type);
  const pathway = value(params.pathway);
  return {
    ...(RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]) ? { type: type as (typeof RESOURCE_TYPES)[number] } : {}),
    ...(PATHWAYS.includes(pathway as (typeof PATHWAYS)[number]) ? { pathway } : {}),
    ...(value(params.tag) ? { tag: value(params.tag) } : {}),
    ...(value(params.search) ? { search: value(params.search) } : {}),
    page: positivePage(params.page), pageSize,
  };
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<PublicSearchParams> }): Promise<Metadata> {
  const { getLocale, getTranslations } = await import('next-intl/server');
  const [requestedLocale, t, params] = await Promise.all([getLocale(), getTranslations('resources'), searchParams]);
  const filters = resourceFilters(params);
  return buildPublicMetadata({
    title: t('title'), description: t('description'), pathname: routes.public.resources(),
    locale: requestedLocale === 'en' ? 'en' : 'vi', page: filters.page,
    filtered: Boolean(filters.search || filters.type || filters.tag || filters.pathway),
  });
}

export default async function PublicResourcesPage({ searchParams }: { searchParams: Promise<PublicSearchParams> }) {
  const [{ getLocale, getTranslations }, { listPublicResources }] = await Promise.all([
    import('next-intl/server'), import('@/features/marketing/public-discovery'),
  ]);
  const [requestedLocale, t, common, params] = await Promise.all([
    getLocale(), getTranslations('resources'), getTranslations('publicDiscovery'), searchParams,
  ]);
  const locale = requestedLocale === 'en' ? 'en' : 'vi';
  const copy = publicResourcesCopy[locale];
  const filters = resourceFilters(params);
  const result = await listPublicResources(locale, filters);
  const query = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.tag ? { tag: filters.tag } : {}),
    ...(filters.pathway ? { pathway: filters.pathway } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  };
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (filters.page > lastPage) {
    const { redirect } = await import('next/navigation');
    redirect(publicHref(routes.public.resources(), locale, { ...query, page: String(lastPage) }));
  }
  const resetHref = publicHref(routes.public.resources(), locale);
  const context = { ...query, page: String(result.page) };
  const filtered = Object.keys(query).length > 0;

  return (
    <PublicCatalogPage
      header={<PublicPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />}
      filters={
        <PublicFilterForm key={JSON.stringify(query)} action={routes.public.resources()} method="get" role="search" className="public-filter-form public-resource-filters">
          <div className="public-field public-resource-filters__search">
            <label htmlFor="public-resource-search">{t('search')}</label>
            <input id="public-resource-search" type="search" name="search" defaultValue={filters.search ?? ''} placeholder={t('searchPlaceholder')} />
          </div>
          <div className="public-field">
            <label htmlFor="public-resource-type">{t('type')}</label>
            <select id="public-resource-type" name="type" defaultValue={filters.type ?? ''}>
              <option value="">{t('allTypes')}</option>
              {RESOURCE_TYPES.map((type) => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
            </select>
          </div>
          <div className="public-field">
            <label htmlFor="public-resource-pathway">{t('pathway')}</label>
            <select id="public-resource-pathway" name="pathway" defaultValue={filters.pathway ?? ''}>
              <option value="">{t('allPathways')}</option>
              {PATHWAYS.map((pathway) => <option key={pathway} value={pathway}>{t(`pathways.${pathway}`)}</option>)}
            </select>
          </div>
          <div className="public-field">
            <label htmlFor="public-resource-tag">{t('tag')}</label>
            <input id="public-resource-tag" name="tag" defaultValue={filters.tag ?? ''} />
          </div>
          <div className="public-actions public-resource-filters__actions">
            <button type="submit" className="public-button">{t('filter')}<ArrowUpRight size={17} aria-hidden="true" /></button>
            {filtered ? <PublicLink href={resetHref} resultNavigation className="public-button public-button--secondary">{t('reset')}</PublicLink> : null}
          </div>
        </PublicFilterForm>
      }
      summary={<span className="public-resource-results"><span>{common('results', { count: result.total })}</span><span>{copy.libraryNote}</span></span>}
    >
      {result.items.length ? (
        <ul className="public-resource-library">
          {result.items.map((item, index) => (
            <li key={item.id}>
              <article className="public-resource-card" data-public-reveal>
                <div className="public-resource-card__top">
                  <span className="public-kicker"><BookOpen size={15} aria-hidden="true" />{t(`types.${item.resourceType}`)}</span>
                  <span className="public-resource-card__number" aria-hidden="true">{String((result.page - 1) * result.pageSize + index + 1).padStart(2, '0')}</span>
                </div>
                <h2><PublicLink href={publicDetailHref('resources', item.id, context, locale)} analytics={{ name: 'public.card_clicked', props: { route: 'resources', catalog: 'resources', itemId: item.id } }}>{item.title}<ArrowUpRight size={24} aria-hidden="true" /></PublicLink></h2>
                <p className="public-resource-card__summary">{item.summary}</p>
                {item.tags.length ? <ul className="public-tags" aria-label={t('tag')}>{[...new Set(item.tags)].slice(0, 4).map((tag) => <li key={tag}>{tag}</li>)}</ul> : null}
                {item.pathways.length ? <p className="public-resource-card__pathway">{item.pathways.filter((pathway) => PATHWAYS.includes(pathway as (typeof PATHWAYS)[number])).map((pathway) => t(`pathways.${pathway}`)).join(' · ')}</p> : null}
              </article>
            </li>
          ))}
        </ul>
      ) : <PublicEmptyState title={t('empty')} description={copy.emptyHelp} resetHref={filtered ? resetHref : undefined} resetLabel={t('reset')} />}
      <PublicPagination page={result.page} pageSize={result.pageSize} total={result.total} query={{ ...query, lang: locale }} href={routes.public.resources} labels={{ navigation: common('pagination.navigation'), previous: common('pagination.previous'), next: common('pagination.next'), summary: common('pagination.summary', { page: result.page, pages: lastPage }) }} />
    </PublicCatalogPage>
  );
}

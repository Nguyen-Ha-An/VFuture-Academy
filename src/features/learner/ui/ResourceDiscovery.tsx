import { useTranslations } from 'next-intl';

import { RESOURCE_TYPES } from '@/content-engine/schema/bundle';
import { PATHWAYS } from '@/content-engine/schema/course';
import type { LocalizedResource, ResourceListFilter, ResourcePage } from '@/features/resources/service';
import { routes } from '@/lib/routes';
import { filterStateKey } from '@/lib/search-params';
import { resourceFilterChips } from '@/features/workspace-ui/learner/directory/chips';
import { DirectoryPage } from '@/features/workspace-ui/learner/directory/DirectoryPage';
import { DirectoryTable, type DirectoryRow } from '@/features/workspace-ui/learner/directory/DirectoryTable';
import { FilterLink } from '@/features/workspace-ui/learner/directory/FilterBar';
import { BenchState } from '@/features/workspace-ui/ui/BenchState';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Notice, StateTag } from '@/features/workspace-ui/ui/primitives';
import type { ExploreTranslate } from './explore-types';

const RESULTS_ID = 'resource-results';

/** Mono row meta: the pathways, then the tags as `#tag`. */
function resourceMeta(resource: LocalizedResource, t: ExploreTranslate): string[] {
  const pathways = resource.pathways.map((pathway) => t(`pathways.${pathway}`)).join(', ');
  const tags = resource.tags.map((tag) => `#${tag}`).join(' ');
  return [pathways, tags].filter(Boolean);
}

export function ResourceDiscoveryList({ resources, filters, invalid, t }: { resources: ResourcePage; filters: ResourceListFilter; invalid: boolean; t: ExploreTranslate }) {
  const learner = useTranslations('learner');
  const directory = useTranslations('learner.directory');
  const chips = resourceFilterChips(filters, t);
  const clearHref = routes.learner.resources();
  const rows: DirectoryRow[] = resources.items.map((resource) => ({
    id: resource.id,
    lead: <StateTag plain>{t(`types.${resource.resourceType}`)}</StateTag>,
    title: resource.title,
    summary: resource.summary,
    meta: resourceMeta(resource, t),
    href: routes.learner.resource(resource.id, filters),
    cta: directory('open'),
    ctaLabel: directory('openItem', { title: resource.title }),
  }));
  return <DirectoryPage
    header={<PageHeader
      crumbs={[{ label: learner('focus.explore'), href: routes.learner.explore() }, { label: learner('focus.resources') }]}
      kicker={directory('kickers.resources')}
      title={t('title')}
      lead={t('description')}
    />}
    notice={invalid ? <Notice tone="fault" label={directory('invalidLabel')}>{t('invalidFilters')}</Notice> : null}
    filters={{
      label: t('filters'),
      summary: chips.length ? directory('filtersSummary', { count: chips.length }) : directory('filters'),
      columns: 5,
      action: clearHref,
      clearHref,
      activeCount: chips.length,
      // Paging never remounts the form or moves focus; only a filter change does.
      stateKey: filterStateKey({ ...filters, page: undefined }),
      fields: [
        { kind: 'search', name: 'search', label: t('search'), value: filters.search, placeholder: t('searchPlaceholder'), wide: true },
        { kind: 'select', name: 'type', label: t('type'), value: filters.type, allLabel: t('allTypes'), options: RESOURCE_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) })) },
        { kind: 'select', name: 'pathway', label: t('pathway'), value: filters.pathway, allLabel: t('allPathways'), options: PATHWAYS.map((pathway) => ({ value: pathway, label: t(`pathways.${pathway}`) })) },
        { kind: 'search', name: 'tag', label: t('tag'), value: filters.tag },
      ],
    }}
    results={{
      id: RESULTS_ID,
      count: t('results', { count: resources.total }),
      chips,
      chipsLabel: directory('activeFilters'),
      removeLabel: (label) => directory('removeFilter', { label }),
    }}
    empty={rows.length === 0 && (chips.length
      ? <BenchState kind="filtered" titleAs="h2" title={t('empty')} actions={<FilterLink href={clearHref} className="vf-btn vf-btn-lg">{directory('clear')}</FilterLink>} />
      : <BenchState kind="empty" titleAs="h2" title={t('emptyAll')} />)}
    pagination={{ page: resources.page, pageSize: resources.pageSize, total: resources.total, href: (page) => routes.learner.resources({ ...filters, page }) }}
  >
    <DirectoryTable
      caption={t('title')}
      titleAs="h2"
      columns={{ lead: directory('columns.type'), title: directory('columns.resource'), cta: directory('columns.next') }}
      rows={rows}
    />
  </DirectoryPage>;
}

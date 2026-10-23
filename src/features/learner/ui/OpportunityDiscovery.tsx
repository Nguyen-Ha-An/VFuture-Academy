import { useTranslations } from 'next-intl';

import { opportunityAvailability, type OpportunityAvailability } from '@/features/opportunities/availability';
import { OPPORTUNITY_TYPES } from '@/features/opportunities/schema';
import type { OpportunityListFilter, OpportunityPage } from '@/features/opportunities/service';
import { routes } from '@/lib/routes';
import { filterStateKey } from '@/lib/search-params';
import { opportunityFilterChips } from '@/features/workspace-ui/learner/directory/chips';
import { DirectoryPage } from '@/features/workspace-ui/learner/directory/DirectoryPage';
import { DirectoryTable, type DirectoryRow } from '@/features/workspace-ui/learner/directory/DirectoryTable';
import { FilterLink } from '@/features/workspace-ui/learner/directory/FilterBar';
import { ictDate } from '@/features/workspace-ui/format';
import { BenchState } from '@/features/workspace-ui/ui/BenchState';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Notice, StateTag, type Tone } from '@/features/workspace-ui/ui/primitives';
import type { ExploreTranslate } from './explore-types';

const RESULTS_ID = 'opportunity-results';

/** Availability tag tone: open is the signal, upcoming is pending, closed is neutral. */
export function availabilityTone(value: OpportunityAvailability): Tone {
  return value === 'open' ? 'signal' : value === 'upcoming' ? 'pending' : 'neutral';
}

/** The closing day as `dd.mm.yyyy` in Vietnam time, or null when missing or unparseable. */
export function closingDay(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return ictDate(value);
}

function repeatsOnlineLabel(location: string | null, online: boolean, onlineLabel: string, locale: string) {
  return Boolean(online && location && location.trim().toLocaleLowerCase(locale) === onlineLabel.trim().toLocaleLowerCase(locale));
}

export function OpportunityDiscoveryList({ opportunities, filters, invalid, now, locale, t }: { opportunities: OpportunityPage; filters: OpportunityListFilter; invalid: boolean; now: Date; locale: string; t: ExploreTranslate }) {
  const learner = useTranslations('learner');
  const directory = useTranslations('learner.directory');
  const chips = opportunityFilterChips(filters, t);
  const clearHref = routes.learner.opportunities();
  const rows: DirectoryRow[] = opportunities.items.map((opportunity) => {
    const availability = opportunityAvailability(opportunity.openAt, opportunity.closeAt, now);
    const closes = closingDay(opportunity.closeAt);
    const showLocation = opportunity.location && !repeatsOnlineLabel(opportunity.location, opportunity.online, t('online'), locale);
    return {
      id: opportunity.id,
      lead: <StateTag plain>{t(`types.${opportunity.type}`)}</StateTag>,
      title: opportunity.title,
      meta: [
        opportunity.featured ? t('featured') : null,
        opportunity.organization,
        showLocation ? opportunity.location : null,
        opportunity.online ? t('online') : null,
        closes ? directory('closesAt', { date: closes }) : null,
      ].filter((entry): entry is string => Boolean(entry)),
      status: { tone: availabilityTone(availability), label: t(`availability.${availability}`) },
      href: routes.learner.opportunity(opportunity.id, filters),
      cta: directory('view'),
      ctaLabel: directory('viewItem', { title: opportunity.title }),
    };
  });
  return <DirectoryPage
    header={<PageHeader
      crumbs={[{ label: learner('focus.explore'), href: routes.learner.explore() }, { label: learner('focus.opportunities') }]}
      kicker={directory('kickers.opportunities')}
      title={t('title')}
      lead={t('description')}
    />}
    notice={invalid ? <Notice tone="fault" label={directory('invalidLabel')}>{t('invalidFilters')}</Notice> : null}
    filters={{
      label: t('filters'),
      summary: chips.length ? directory('filtersSummary', { count: chips.length }) : directory('filters'),
      columns: 2,
      action: clearHref,
      clearHref,
      activeCount: chips.length,
      stateKey: filterStateKey({ ...filters, page: undefined }),
      // `featured=false` only arrives from a URL. Carry it while it applies; the Featured-only box
      // is unchecked then, and a checked box replaces the fallback on submit.
      hidden: filters.featured === false ? { featured: 'false' } : undefined,
      fields: [
        { kind: 'select', name: 'type', label: t('type'), value: filters.type, allLabel: t('allTypes'), options: OPPORTUNITY_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) })) },
        { kind: 'checks', legend: directory('show'), items: [
          { name: 'openNow', label: t('openNow'), checked: filters.openNow === true },
          { name: 'featured', label: t('featuredOnly'), checked: filters.featured === true },
        ] },
      ],
    }}
    results={{
      id: RESULTS_ID,
      count: t('results', { count: opportunities.total }),
      chips,
      chipsLabel: directory('activeFilters'),
      removeLabel: (label) => directory('removeFilter', { label }),
    }}
    empty={rows.length === 0 && (chips.length
      ? <BenchState kind="filtered" titleAs="h2" title={t('empty')} actions={<FilterLink href={clearHref} className="vf-btn vf-btn-lg">{directory('clear')}</FilterLink>} />
      : <BenchState kind="empty" titleAs="h2" title={t('emptyAll')} />)}
    pagination={{ page: opportunities.page, pageSize: opportunities.pageSize, total: opportunities.total, href: (page) => routes.learner.opportunities({ ...filters, page }) }}
  >
    <DirectoryTable
      caption={t('title')}
      titleAs="h2"
      columns={{ lead: directory('columns.type'), title: directory('columns.opportunity'), status: directory('columns.availability'), cta: directory('columns.next') }}
      rows={rows}
    />
  </DirectoryPage>;
}

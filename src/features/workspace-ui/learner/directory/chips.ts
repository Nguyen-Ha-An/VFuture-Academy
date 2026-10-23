import type { CatalogFilters } from '@/features/catalog/service';
import type { OpportunityListFilter } from '@/features/opportunities/service';
import type { ProjectBenchFilter } from '@/features/projects/ui/project-bench-model';
import type { ResourceListFilter } from '@/features/resources/service';
import { routes } from '@/lib/routes';

/** A removable applied filter: its visible label and the list URL without it. */
export type FilterChip = { key: string; label: string; href: string };
export type ChipTranslate = (key: string, values?: Record<string, string | number>) => string;

const present = (entry: FilterChip | null): entry is FilterChip => entry !== null;

/** Resource chips; `t` is the `resources` namespace. Removing a filter restarts at page 1. */
export function resourceFilterChips(filters: ResourceListFilter, t: ChipTranslate): FilterChip[] {
  const page = 1;
  return [
    filters.search ? { key: 'search', label: `${t('search')}: ${filters.search}`, href: routes.learner.resources({ ...filters, search: undefined, page }) } : null,
    filters.type ? { key: 'type', label: t(`types.${filters.type}`), href: routes.learner.resources({ ...filters, type: undefined, page }) } : null,
    filters.pathway ? { key: 'pathway', label: t(`pathways.${filters.pathway}`), href: routes.learner.resources({ ...filters, pathway: undefined, page }) } : null,
    filters.tag ? { key: 'tag', label: `${t('tag')}: ${filters.tag}`, href: routes.learner.resources({ ...filters, tag: undefined, page }) } : null,
  ].filter(present);
}

/**
 * Opportunity chips; `t` is the `opportunities` namespace. `featured=false` is a URL-only filter
 * and still gets a chip.
 */
export function opportunityFilterChips(filters: OpportunityListFilter, t: ChipTranslate): FilterChip[] {
  const page = 1;
  return [
    filters.type ? { key: 'type', label: t(`types.${filters.type}`), href: routes.learner.opportunities({ ...filters, type: undefined, page }) } : null,
    filters.openNow ? { key: 'openNow', label: t('openNow'), href: routes.learner.opportunities({ ...filters, openNow: undefined, page }) } : null,
    filters.featured !== undefined ? { key: 'featured', label: t(filters.featured ? 'featured' : 'notFeatured'), href: routes.learner.opportunities({ ...filters, featured: undefined, page }) } : null,
  ].filter(present);
}

const catalogKeys = ['level', 'pathway', 'difficulty', 'language'] as const;

/** Course catalog chips; `t` is the `learner.enums` namespace. The tab is kept on every href. */
export function catalogFilterChips(filters: CatalogFilters, tab: string | undefined, t: ChipTranslate): FilterChip[] {
  return catalogKeys.map((key): FilterChip | null => {
    const value = filters[key];
    return value ? { key, label: t(`${key}.${value}`), href: routes.learner.courses({ tab, ...filters, [key]: undefined }) } : null;
  }).filter(present);
}

/**
 * Project chips; `t` is the `build` namespace. Skill and course ids resolve through `labels`, and
 * fall back to the id itself.
 */
export function projectFilterChips(
  filters: ProjectBenchFilter,
  t: ChipTranslate,
  labels: { skills?: ReadonlyMap<string, string>; courses?: ReadonlyMap<string, string> } = {},
): FilterChip[] {
  return [
    filters.status ? { key: 'status', label: t(`status.${filters.status}`), href: routes.learner.projects({ ...filters, status: undefined }) } : null,
    filters.skill ? { key: 'skill', label: `${t('filters.skillName')}: ${labels.skills?.get(filters.skill) ?? filters.skill}`, href: routes.learner.projects({ ...filters, skill: undefined }) } : null,
    filters.course ? { key: 'course', label: `${t('filters.courseName')}: ${labels.courses?.get(filters.course) ?? filters.course}`, href: routes.learner.projects({ ...filters, course: undefined }) } : null,
  ].filter(present);
}

import { ID_PATTERN } from '@/content-engine/schema/common';
import {
  PROJECT_STATUSES,
  type ProjectFilters,
  type ProjectStatus,
} from '@/features/projects/service';
import {
  OpportunityListFilterSchema,
  type OpportunityListFilter,
} from '@/features/opportunities/service';
import {
  ResourceListFilterSchema,
  type ResourceListFilter,
} from '@/features/resources/service';
import { firstNonEmpty } from '@/lib/search-params';

export type LearnerListSearchParams = Record<string, string | string[] | undefined>;

export function resourceListContext(params: LearnerListSearchParams) {
  const candidate = {
    type: firstNonEmpty(params.type),
    tag: firstNonEmpty(params.tag),
    pathway: firstNonEmpty(params.pathway),
    search: firstNonEmpty(params.search),
    page: firstNonEmpty(params.page),
  };
  const filters: Record<string, unknown> = {};
  let invalid = false;
  for (const key of ['type', 'tag', 'pathway', 'search', 'page'] as const) {
    if (!candidate[key]) continue;
    const parsed = ResourceListFilterSchema.shape[key].safeParse(candidate[key]);
    if (parsed.success) filters[key] = parsed.data;
    else invalid = true;
  }
  if (invalid && !('page' in filters)) filters.page = 1;
  return {
    filters: ResourceListFilterSchema.parse(filters) as ResourceListFilter,
    invalid,
  };
}

function booleanFilter(value: string | undefined): boolean | string | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** Parses each key on its own, so one bad param drops only itself (F1). */
export function opportunityListContext(params: LearnerListSearchParams) {
  const candidate = {
    type: firstNonEmpty(params.type),
    openNow: booleanFilter(firstNonEmpty(params.openNow)),
    featured: booleanFilter(firstNonEmpty(params.featured)),
    page: firstNonEmpty(params.page),
  };
  const filters: Record<string, unknown> = {};
  let invalid = false;
  for (const key of ['type', 'openNow', 'featured', 'page'] as const) {
    if (candidate[key] === undefined) continue;
    const parsed = OpportunityListFilterSchema.shape[key].safeParse(candidate[key]);
    if (parsed.success) filters[key] = parsed.data;
    else invalid = true;
  }
  if (invalid && !('page' in filters)) filters.page = 1;
  return {
    filters: OpportunityListFilterSchema.parse(filters) as OpportunityListFilter,
    invalid,
    success: !invalid,
  };
}

export function projectListContext(params: LearnerListSearchParams): {
  filters: ProjectFilters;
  query: { status?: ProjectStatus; skill?: string; course?: string };
} {
  const rawStatus = firstNonEmpty(params.status);
  const rawSkill = firstNonEmpty(params.skill);
  const rawCourse = firstNonEmpty(params.course);
  const status = PROJECT_STATUSES.includes(rawStatus as ProjectStatus)
    ? rawStatus as ProjectStatus
    : undefined;
  const skill = rawSkill && ID_PATTERN.test(rawSkill) ? rawSkill : undefined;
  const course = rawCourse && ID_PATTERN.test(rawCourse) ? rawCourse : undefined;
  return {
    filters: {
      ...(status ? { statuses: [status] } : {}),
      ...(skill ? { skills: [skill] } : {}),
      ...(course ? { courseIds: [course] } : {}),
    },
    query: {
      ...(status ? { status } : {}),
      ...(skill ? { skill } : {}),
      ...(course ? { course } : {}),
    },
  };
}

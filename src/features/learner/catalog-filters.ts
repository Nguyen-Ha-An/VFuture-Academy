import { PATHWAYS } from '@/content-engine/schema/course';
import type { CatalogFilters } from '@/features/catalog/service';

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseCatalogFilters(searchParams: CatalogSearchParams): CatalogFilters {
  const level = scalar(searchParams.level);
  const pathway = scalar(searchParams.pathway);
  const difficulty = scalar(searchParams.difficulty);
  const language = scalar(searchParams.language);
  return {
    ...(level === 'foundation' || level === 'specialization' ? { level } : {}),
    ...(pathway && (PATHWAYS as readonly string[]).includes(pathway) ? { pathway } : {}),
    ...(difficulty === 'beginner' || difficulty === 'intermediate' || difficulty === 'advanced'
      ? { difficulty }
      : {}),
    ...(language === 'vi' || language === 'en' ? { language } : {}),
  };
}

export function parseCatalogContext(searchParams: CatalogSearchParams) {
  return {
    tab: scalar(searchParams.tab) === 'discover' ? 'discover' as const : 'learning' as const,
    ...parseCatalogFilters(searchParams),
  };
}

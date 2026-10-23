import 'server-only';

import type { AdminContext } from '@/features/admin/context';
import { actorPermissionCheck as bankPermissionCheck, createBankService, type BankDatabase, type BankListFilter } from '@/features/bank/service';
import { createMediaLibraryService, type MediaLibraryDatabase } from '@/features/media/library';
import { actorOpportunityPermissionCheck, createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { actorPermissionCheck as projectPermissionCheck, createProjectService, createSupabaseProjectStore, type ProjectDatabase } from '@/features/projects/service';
import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase } from '@/features/resources/service';
import type { BankListItem } from '@/features/studio/ui/BankTable';
import type { MediaAssetWithUsages } from '@/features/studio/ui/MediaLibrary';
import { supabaseService } from '@/lib/supabase/server';

/**
 * The one data module behind the Studio content lists (resources, opportunities, projects,
 * question bank, media). Pages call it and hand plain rows to the presentational views,
 * so tests and the e2e harness can replace the data without the services.
 */

type ListContext = Pick<AdminContext, 'actor' | 'scope'>;
type Locale = 'vi' | 'en';

/** Page size of the resources and opportunities `listStudio` queries. */
export const STUDIO_LIST_PAGE_SIZE = 50;

export type ContentListKind = 'resource' | 'opportunity' | 'project';

/** One row of a Studio content table; every field is plain, serializable data. */
export type ContentListRow = {
  id: string;
  /** Localized title, or null when the record has none (the view shows "Untitled"). */
  title: string | null;
  /** Content status (draft/published/archived) or, for projects, the project status. */
  status: string;
  /** Resource type or opportunity type; null for projects. */
  type: string | null;
  /** A second line under the title: the organization for opportunities, else null. */
  secondary: string | null;
  updatedAt: string | null;
  /** Projects only: approved for the learner showcase. */
  approved?: boolean;
};

export type ContentListPage = {
  rows: ContentListRow[];
  page: number;
  /** A full page came back, so another page may exist. */
  hasMore: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** A string title, or the requested language, then the other one. */
export function localizedTitle(value: unknown, locale: Locale): string | null {
  if (typeof value === 'string') return text(value);
  const titles = record(value);
  return text(titles?.[locale]) ?? text(titles?.[locale === 'vi' ? 'en' : 'vi']);
}

function contentStatus(value: unknown): 'draft' | 'published' | 'archived' {
  return value === 'published' || value === 'archived' ? value : 'draft';
}

export function listPage(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

function toPage(rows: ContentListRow[], page: number, fetched: number): ContentListPage {
  return { rows, page, hasMore: fetched >= STUDIO_LIST_PAGE_SIZE };
}

export async function loadStudioResources(context: ListContext, { page = 1, locale }: { page?: number; locale: Locale }): Promise<ContentListPage> {
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
  const raw = await (page === 1 ? service.listStudio() : service.listStudio(page));
  const rows = raw.flatMap((value): ContentListRow[] => {
    const row = record(value);
    if (!row || typeof row.id !== 'string') return [];
    const document = record(row.document);
    return [{
      id: row.id,
      title: localizedTitle(document?.title, locale),
      status: contentStatus(row.status),
      type: text(document?.resourceType),
      secondary: null,
      updatedAt: text(row.updated_at),
    }];
  });
  return toPage(rows, page, raw.length);
}

export async function loadStudioOpportunities(context: ListContext, { page = 1, locale }: { page?: number; locale: Locale }): Promise<ContentListPage> {
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: actorOpportunityPermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
  const raw = await (page === 1 ? service.listStudio() : service.listStudio(page));
  const rows = raw.flatMap((value): ContentListRow[] => {
    const row = record(value);
    if (!row || typeof row.id !== 'string') return [];
    return [{
      id: row.id,
      title: localizedTitle(row.title, locale),
      status: contentStatus(row.status),
      type: text(row.type),
      secondary: text(row.organization),
      updatedAt: text(row.updated_at),
    }];
  });
  return toPage(rows, page, raw.length);
}

/** Projects come back whole (the service filters in memory), so the list is complete. */
export async function loadStudioProjects(context: ListContext, { locale }: { locale: Locale }): Promise<ContentListRow[]> {
  const service = createProjectService({
    store: createSupabaseProjectStore(supabaseService() as unknown as ProjectDatabase),
    authorize: projectPermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
  const projects = await service.listStudio({});
  return projects
    .map((project): ContentListRow => ({
      id: project.id,
      title: localizedTitle(project.title, locale),
      status: project.status,
      type: null,
      secondary: null,
      updatedAt: text(project.updatedAt),
      approved: project.approved,
    }))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export async function loadStudioBank(context: ListContext, filters: BankListFilter): Promise<BankListItem[]> {
  const service = createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: bankPermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
  const rows = await service.list(filters);
  const validRows = rows.flatMap((value) => {
    const row = record(value);
    if (!row || typeof row.id !== 'string' || typeof row.type !== 'string' || typeof row.status !== 'string') return [];
    return [row as Record<string, unknown> & { id: string; type: string; status: string }];
  });
  const usages = await service.usagesMany(validRows.map((row) => row.id));
  return validRows.map((row): BankListItem => ({
    id: row.id,
    type: row.type,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    difficulty: typeof row.difficulty === 'string' ? row.difficulty : null,
    status: row.status,
    usages: usages.get(row.id) ?? [],
  }));
}

export async function loadStudioMedia(context: ListContext): Promise<MediaAssetWithUsages[]> {
  const actor = context.actor;
  const service = createMediaLibraryService({ database: supabaseService() as unknown as MediaLibraryDatabase, authorize: async () => actor, scope: context.scope });
  const assets = await service.listAssets();
  const usages = await service.usagesForAssets(assets.map((asset) => asset.id));
  return assets.map((asset) => ({ ...asset, usages: usages.get(asset.id) ?? [] }));
}

import 'server-only';

import { z } from 'zod';
import { MediaRefSchema } from '@/content-engine/schema/common';

import { ApiError } from '@/lib/api';
import type { Scope } from '@/lib/permissions';

type QueryResult = { data: unknown; error: unknown | null };

export interface MediaLibraryQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(value: number): this;
  range(from: number, to: number): this;
  update(value: unknown): this;
  eq(column: string, value: unknown): this;
  maybeSingle(): Promise<QueryResult>;
}

export interface MediaLibraryDatabase {
  from(table: string): MediaLibraryQuery;
}

type Authorize = (permission: 'media.upload') => Promise<unknown>;

export const MediaAltSchema = z.object({
  vi: z.string().max(2_000),
  en: z.string().max(2_000),
}).strict();

export type MediaAlt = z.infer<typeof MediaAltSchema>;

export type MediaUsage = {
  source: 'draft' | 'version';
  courseId: string;
  itemId: string;
  version: number | null;
} | {
  source: 'resource';
  resourceId: string;
} | {
  source: 'project';
  projectId: string;
} | {
  source: 'bank_version';
  questionId: string;
  version: number;
};

export type MediaAsset = {
  id: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  filename: string;
  alt: MediaAlt;
  createdAt: string | null;
};

type Dependencies = { database: MediaLibraryDatabase; authorize: Authorize; scope?: Scope };
const USAGE_PAGE_SIZE = 500;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry): Record<string, unknown>[] => {
    const parsed = record(entry);
    return parsed ? [parsed] : [];
  }) : [];
}

function databaseError(message: string): never {
  throw new ApiError(500, 'MEDIA_DATABASE_ERROR', message);
}

function validAssetId(assetId: string): string {
  if (!MediaRefSchema.safeParse({ assetId }).success) throw new ApiError(400, 'INVALID_ASSET_ID', 'Media asset id is invalid');
  return assetId;
}

function referencedAssetIds(value: unknown, requested: ReadonlySet<string>, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) referencedAssetIds(entry, requested, found);
    return found;
  }
  const object = record(value);
  if (!object) return found;
  if (typeof object.assetId === 'string' && requested.has(object.assetId)) found.add(object.assetId);
  for (const entry of Object.values(object)) referencedAssetIds(entry, requested, found);
  return found;
}

function altOf(value: unknown): MediaAlt {
  const alt = record(value);
  return {
    vi: typeof alt?.vi === 'string' ? alt.vi : '',
    en: typeof alt?.en === 'string' ? alt.en : '',
  };
}

async function allRows(database: MediaLibraryDatabase, table: string, columns: string, orderColumns: string[]): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  for (let start = 0; ; start += USAGE_PAGE_SIZE) {
    let query = database.from(table).select(columns);
    for (const column of orderColumns) query = query.order(column);
    const result = await query.range(start, start + USAGE_PAGE_SIZE - 1);
    if (result.error) databaseError('Media usages could not be loaded');
    const page = rows(result.data);
    found.push(...page);
    if (page.length < USAGE_PAGE_SIZE) return found;
  }
}

export function createMediaLibraryService({ database, authorize, scope }: Dependencies) {
  return {
    async listAssets(): Promise<MediaAsset[]> {
      await authorize('media.upload');
      let query = database.from('media_assets').select('id,bucket,path,mime,size_bytes,width,height,alt,created_at,purpose');
      query = query.eq('bucket', 'media');
      query = query.eq('purpose', 'content');
      if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) databaseError('Media assets could not be listed');
      return rows(data).flatMap((row) => {
        if (row.bucket !== 'media' || (row.purpose !== undefined && row.purpose !== 'content') || typeof row.id !== 'string' || typeof row.path !== 'string' || typeof row.mime !== 'string' || typeof row.size_bytes !== 'number') return [];
        return [{
          id: row.id,
          mime: row.mime,
          sizeBytes: row.size_bytes,
          width: typeof row.width === 'number' ? row.width : null,
          height: typeof row.height === 'number' ? row.height : null,
          filename: row.path.replaceAll('\\', '/').split('/').pop() ?? row.id,
          alt: altOf(row.alt),
          createdAt: typeof row.created_at === 'string' ? row.created_at : null,
        }];
      });
    },

    async updateAlt(assetId: string, rawAlt: unknown): Promise<{ id: string; alt: MediaAlt }> {
      await authorize('media.upload');
      const id = validAssetId(assetId);
      const alt = MediaAltSchema.parse(rawAlt);
      let query = database.from('media_assets')
        .update({ alt })
        .eq('id', id)
        .eq('bucket', 'media')
        .eq('purpose', 'content');
      if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
      const { data, error } = await query.select('id,bucket,alt').maybeSingle();
      if (error) databaseError('Media alt text could not be saved');
      const saved = record(data);
      if (!saved || saved.id !== id || saved.bucket !== 'media' || (saved.purpose !== undefined && saved.purpose !== 'content')) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media asset was not found');
      return { id, alt: altOf(saved.alt) };
    },

    async usagesForAssets(assetIds: string[]): Promise<Map<string, MediaUsage[]>> {
      await authorize('media.upload');
      const ids = [...new Set(assetIds.map(validAssetId))];
      const indexed = new Map(ids.map((id) => [id, [] as MediaUsage[]]));
      if (ids.length === 0) return indexed;
      if (scope?.kind === 'branch') return indexed;
      const requested = new Set(ids);
      const [draftItems, draftsRows, versionItems, versionsRows, versionRenders, bankVersions, resources, projects] = await Promise.all([
        allRows(database, 'course_draft_items', 'draft_id,item_id,document', ['draft_id', 'item_id']),
        allRows(database, 'course_drafts', 'id,course_id,manifest', ['id']),
        allRows(database, 'course_version_items', 'version_id,item_id,source', ['version_id', 'item_id']),
        allRows(database, 'course_versions', 'id,course_id,version,manifest', ['id']),
        allRows(database, 'course_version_item_renders', 'version_id,item_id,locale,payload', ['version_id', 'item_id', 'locale']),
        allRows(database, 'bank_question_versions', 'question_id,version,payload,renders,grading', ['question_id', 'version']),
        allRows(database, 'resources', 'id,document', ['id']),
        allRows(database, 'projects', 'id,cover_asset_id', ['id']),
      ]);

      const drafts = new Map(draftsRows.flatMap((row) => typeof row.id === 'string' && typeof row.course_id === 'string' ? [[row.id, row.course_id] as const] : []));
      const versions = new Map(versionsRows.flatMap((row) => typeof row.id === 'string' && typeof row.course_id === 'string' && typeof row.version === 'number' ? [[row.id, { courseId: row.course_id, version: row.version }] as const] : []));
      const seen = new Map(ids.map((id) => [id, new Set<string>()]));
      const addUsage = (assetId: string, usage: MediaUsage) => {
        const key = JSON.stringify(usage);
        if (seen.get(assetId)?.has(key)) return;
        seen.get(assetId)?.add(key);
        indexed.get(assetId)?.push(usage);
      };
      for (const row of draftItems) {
        const courseId = typeof row.draft_id === 'string' ? drafts.get(row.draft_id) : undefined;
        if (!courseId || typeof row.item_id !== 'string') continue;
        for (const assetId of referencedAssetIds(row.document, requested)) {
          addUsage(assetId, { source: 'draft', courseId, itemId: row.item_id, version: null });
        }
      }
      for (const row of draftsRows) {
        const courseId = typeof row.id === 'string' ? drafts.get(row.id) : undefined;
        if (!courseId) continue;
        for (const assetId of referencedAssetIds(row.manifest, requested)) {
          addUsage(assetId, { source: 'draft', courseId, itemId: 'manifest', version: null });
        }
      }
      for (const row of [...versionItems, ...versionRenders]) {
        const version = typeof row.version_id === 'string' ? versions.get(row.version_id) : undefined;
        if (!version || typeof row.item_id !== 'string') continue;
        for (const assetId of referencedAssetIds(row.source ?? row.payload, requested)) {
          addUsage(assetId, { source: 'version', courseId: version.courseId, itemId: row.item_id, version: version.version });
        }
      }
      for (const row of versionsRows) {
        const version = typeof row.id === 'string' ? versions.get(row.id) : undefined;
        if (!version) continue;
        for (const assetId of referencedAssetIds(row.manifest, requested)) {
          addUsage(assetId, { source: 'version', courseId: version.courseId, itemId: 'manifest', version: version.version });
        }
      }
      for (const row of bankVersions) {
        if (typeof row.question_id !== 'string' || typeof row.version !== 'number') continue;
        for (const assetId of referencedAssetIds([row.payload, row.renders, row.grading], requested)) {
          addUsage(assetId, { source: 'bank_version', questionId: row.question_id, version: row.version });
        }
      }
      for (const row of resources) {
        if (typeof row.id !== 'string') continue;
        for (const assetId of referencedAssetIds(row.document, requested)) {
          addUsage(assetId, { source: 'resource', resourceId: row.id });
        }
      }
      for (const row of projects) {
        if (typeof row.id === 'string' && typeof row.cover_asset_id === 'string' && requested.has(row.cover_asset_id)) {
          addUsage(row.cover_asset_id, { source: 'project', projectId: row.id });
        }
      }
      return indexed;
    },

    async usages(assetId: string): Promise<MediaUsage[]> {
      const indexed = await this.usagesForAssets([assetId]);
      return indexed.get(assetId) ?? [];
    },
  };
}

async function productionService() {
  const [{ supabaseService }, { requirePermission }] = await Promise.all([
    import('@/lib/supabase/server'),
    import('@/lib/permissions'),
  ]);
  return createMediaLibraryService({
    database: supabaseService() as unknown as MediaLibraryDatabase,
    authorize: requirePermission,
  });
}

export async function listMediaAssets() {
  return (await productionService()).listAssets();
}

export async function updateMediaAlt(assetId: string, alt: unknown) {
  return (await productionService()).updateAlt(assetId, alt);
}

export async function mediaUsages(assetId: string) {
  return (await productionService()).usages(assetId);
}

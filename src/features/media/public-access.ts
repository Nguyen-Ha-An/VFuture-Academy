import 'server-only';

import { ApiError } from '@/lib/api';

type Result = { data: unknown; error: unknown | null };
export interface PublicMediaQuery extends PromiseLike<Result> {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  limit(value: number): this;
  range(from: number, to: number): this;
}
export interface PublicMediaDatabase { from(table: string): PublicMediaQuery }

const SCAN_PAGE_SIZE = 200;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function referencesAsset(value: unknown, assetId: string): boolean {
  if (Array.isArray(value)) return value.some((item) => referencesAsset(item, assetId));
  const object = record(value);
  if (!object) return false;
  if (object.assetId === assetId) return true;
  return Object.values(object).some((item) => referencesAsset(item, assetId));
}

/** Allows only asset positions deliberately included in anonymous public projections. */
export async function isPublicProjectionAsset(database: PublicMediaDatabase, assetId: string): Promise<boolean> {
  async function courseCover(): Promise<boolean> {
    for (let from = 0; ; from += SCAN_PAGE_SIZE) {
      const coursesResult = await database.from('courses').select('current_version_id,status')
        .eq('status', 'published').range(from, from + SCAN_PAGE_SIZE - 1);
      if (coursesResult.error) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
      const courseRows = Array.isArray(coursesResult.data) ? coursesResult.data : [];
      const versionIds = courseRows.flatMap((value) => {
        const row = record(value);
        return row?.status === 'published' && typeof row.current_version_id === 'string' ? [row.current_version_id] : [];
      });
      if (versionIds.length > 0) {
        const outlineResult = await database.from('course_version_outline').select('version_id,meta,access')
          .in('version_id', versionIds).eq('access->>scope', 'global').range(0, SCAN_PAGE_SIZE - 1);
        if (outlineResult.error) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
        if ((Array.isArray(outlineResult.data) ? outlineResult.data : []).some((value) => {
          const row = record(value);
          return typeof row?.version_id === 'string' && versionIds.includes(row.version_id)
            && record(row?.access)?.scope === 'global' && referencesAsset(record(row?.meta)?.cover, assetId);
        })) return true;
      }
      if (courseRows.length < SCAN_PAGE_SIZE) return false;
    }
  }

  async function resourceAsset(): Promise<boolean> {
    for (let from = 0; ; from += SCAN_PAGE_SIZE) {
      const result = await database.from('resources').select('document,status,branch_scope')
        .eq('status', 'published').eq('branch_scope->>scope', 'global').range(from, from + SCAN_PAGE_SIZE - 1);
      if (result.error) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
      const resourceRows = Array.isArray(result.data) ? result.data : [];
      if (resourceRows.some((value) => {
        const row = record(value);
        const document = record(row?.document);
        return row?.status === 'published' && record(row.branch_scope)?.scope === 'global'
          && (referencesAsset(document?.body, assetId) || referencesAsset(document?.attachments, assetId));
      })) return true;
      if (resourceRows.length < SCAN_PAGE_SIZE) return false;
    }
  }

  const [courseCoverAllowed, resourceAssetAllowed, projectResult] = await Promise.all([
    courseCover(),
    resourceAsset(),
    database.from('projects').select('cover_asset_id,approved,branch_scope').eq('approved', true).eq('branch_scope->>scope', 'global').eq('cover_asset_id', assetId).limit(1),
  ]);
  if (projectResult.error) {
    throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
  }
  const projectCover = Array.isArray(projectResult.data) && projectResult.data.some((value) => {
    const row = record(value);
    return row?.approved === true && record(row.branch_scope)?.scope === 'global' && row.cover_asset_id === assetId;
  });
  return courseCoverAllowed || resourceAssetAllowed || projectCover;
}

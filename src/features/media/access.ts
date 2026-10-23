import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import type { supabaseService } from '@/lib/supabase/server';

type MediaAccessDatabase = Pick<ReturnType<typeof supabaseService>, 'from'>;
const PAGE_SIZE = 500;
const VERSION_CHUNK_SIZE = 50;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const parsed = record(entry);
      return parsed ? [parsed] : [];
    })
    : [];
}

function referencesAsset(value: unknown, assetId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => referencesAsset(entry, assetId));
  const object = record(value);
  if (!object) return false;
  if (object.assetId === assetId) return true;
  return Object.values(object).some((entry) => referencesAsset(entry, assetId));
}

function resourceVisibleToBranch(scopeValue: unknown, branchId: string | null): boolean {
  const scope = record(scopeValue);
  if (scope?.scope === 'global') return true;
  if (scope?.scope !== 'branches' || !branchId || !Array.isArray(scope.branchIds)) return false;
  return scope.branchIds.some((value) => value === branchId);
}

function eligibleResourceReferencesAsset(row: Record<string, unknown>, branchId: string | null, assetId: string): boolean {
  if (typeof row.id !== 'string' || !resourceVisibleToBranch(row.branch_scope, branchId)) return false;
  const document = ResourceDocumentSchema.safeParse(row.document);
  if (!document.success || document.data.id !== row.id) return false;
  return referencesAsset([document.data.body, document.data.attachments], assetId);
}

async function enrolledVersionIds(database: MediaAccessDatabase, actor: Actor): Promise<string[]> {
  const found = new Set<string>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const result = await database.from('enrollments')
      .select('course_version_id,branch_id,branch_scope_known')
      .eq('user_id', actor.userId)
      .in('status', ['active', 'completed'])
      .order('course_version_id')
      .range(start, start + PAGE_SIZE - 1);
    if (result.error) throw new Error('Media enrollment lookup failed');
    const page = rows(result.data);
    for (const row of page) {
      if (typeof row.course_version_id !== 'string') continue;
      try {
        await assertEnrollmentMembershipAccess(actor, row, database as unknown as MembershipAccessDatabase);
        found.add(row.course_version_id);
      } catch (error) {
        // A suspended grant does not invalidate an independent enrollment or resource grant.
        if (!(error instanceof ApiError && error.code === 'MEMBERSHIP_SUSPENDED')) throw error;
      }
    }
    if (page.length < PAGE_SIZE) return [...found];
  }
}

async function referencesPublishedAsset(
  database: MediaAccessDatabase,
  table: 'course_version_items' | 'course_version_item_renders',
  documentColumn: 'source' | 'payload',
  versionIds: string[],
  assetId: string,
): Promise<boolean> {
  for (let chunkStart = 0; chunkStart < versionIds.length; chunkStart += VERSION_CHUNK_SIZE) {
    const versionChunk = versionIds.slice(chunkStart, chunkStart + VERSION_CHUNK_SIZE);
    const allowedVersions = new Set(versionChunk);
    for (let start = 0; ; start += PAGE_SIZE) {
      const result = await database.from(table)
        .select(`version_id,${documentColumn}`)
        .in('version_id', versionChunk)
        .order('version_id')
        .order('item_id')
        .range(start, start + PAGE_SIZE - 1);
      if (result.error) throw new Error('Published media reference lookup failed');
      const page = rows(result.data);
      if (page.some((row) => typeof row.version_id === 'string'
        && allowedVersions.has(row.version_id)
        && referencesAsset(row[documentColumn], assetId))) {
        return true;
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return false;
}

/** Checks whether a membership-eligible enrollment reaches a published asset reference. */
export async function isEnrolledForAsset(
  database: MediaAccessDatabase,
  userId: string,
  assetId: string,
  actor: Actor = { userId, roles: [] },
): Promise<boolean> {
  const versionIds = await enrolledVersionIds(database, actor);
  if (versionIds.length === 0) return false;
  return await referencesPublishedAsset(database, 'course_version_items', 'source', versionIds, assetId)
    || referencesPublishedAsset(database, 'course_version_item_renders', 'payload', versionIds, assetId);
}

/** Checks published resource references against the signed-in user's exact profile branch. */
export async function isEligibleResourceAsset(
  database: MediaAccessDatabase,
  userId: string,
  assetId: string,
): Promise<boolean> {
  const profileResult = await database.from('profiles')
    .select('branch_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileResult.error) throw new Error('Media resource profile lookup failed');
  const profile = record(profileResult.data);
  if (!profile || !('branch_id' in profile)) return false;
  const branchId = typeof profile.branch_id === 'string' ? profile.branch_id : null;

  for (let start = 0; ; start += PAGE_SIZE) {
    const result = await database.from('resources')
      .select('id,status,branch_scope,document')
      .eq('status', 'published')
      .order('id')
      .range(start, start + PAGE_SIZE - 1);
    if (result.error) throw new Error('Media resource reference lookup failed');
    const page = rows(result.data);
    if (page.some((row) => row.status === 'published'
      && eligibleResourceReferencesAsset(row, branchId, assetId))) {
      return true;
    }
    if (page.length < PAGE_SIZE) return false;
  }
}

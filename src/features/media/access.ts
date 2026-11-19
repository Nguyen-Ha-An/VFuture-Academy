import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { assertEnrollmentMembershipAccess, eligibleAudienceBranch, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import { learnerItemProjection } from '@/features/learning/item-projection';
import { outlineItems, type OutlineItem } from '@/features/learning/shared';
import { referencesAsset } from './references';
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

async function enrolledVersionIds(database: MediaAccessDatabase, actor: Actor, versionId?: string): Promise<string[]> {
  const found = new Set<string>();
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = database.from('enrollments')
      .select('course_version_id,branch_id,branch_scope_known')
      .eq('user_id', actor.userId)
      .in('status', ['active', 'completed']);
    if (versionId) query = query.eq('course_version_id', versionId);
    const result = await query.order('course_version_id').range(start, start + PAGE_SIZE - 1);
    if (result.error) throw new Error('Media enrollment lookup failed');
    const page = rows(result.data);
    for (const row of page) {
      if (typeof row.course_version_id !== 'string' || (versionId && row.course_version_id !== versionId)) continue;
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

export async function hasMediaEnrollment(database: MediaAccessDatabase, actor: Actor, versionId: string): Promise<boolean> {
  return (await enrolledVersionIds(database, actor, versionId)).includes(versionId);
}

async function referencesEnrolledItem(
  database: MediaAccessDatabase,
  versionIds: string[],
  assetId: string,
): Promise<boolean> {
  for (let chunkStart = 0; chunkStart < versionIds.length; chunkStart += VERSION_CHUNK_SIZE) {
    const versionChunk = versionIds.slice(chunkStart, chunkStart + VERSION_CHUNK_SIZE);
    const outlines = await database.from('course_version_outline').select('version_id,meta,outline')
      .in('version_id', versionChunk);
    if (outlines.error) throw new Error('Course media outline lookup failed');
    const itemsByVersion = new Map<string, Map<string, OutlineItem>>();
    for (const outline of rows(outlines.data)) {
      if (typeof outline.version_id !== 'string' || !versionChunk.includes(outline.version_id)) continue;
      if (referencesAsset(record(outline.meta)?.cover, assetId)) return true;
      itemsByVersion.set(outline.version_id, new Map(outlineItems(outline.outline).map((item) => [item.id, item])));
    }
    if (!itemsByVersion.size) continue;
    for (let start = 0; ; start += PAGE_SIZE) {
      const result = await database.from('course_version_item_renders')
        .select('version_id,item_id,payload')
        .in('version_id', versionChunk)
        .order('version_id')
        .order('item_id')
        .order('locale')
        .range(start, start + PAGE_SIZE - 1);
      if (result.error) throw new Error('Published media reference lookup failed');
      const page = rows(result.data);
      for (const row of page) {
        if (typeof row.version_id !== 'string' || typeof row.item_id !== 'string') continue;
        const item = itemsByVersion.get(row.version_id)?.get(row.item_id);
        const payload = record(row.payload);
        if (item && payload?.id === item.id && payload.kind === item.type
          && referencesAsset(learnerItemProjection(item, payload), assetId)) return true;
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
  return referencesEnrolledItem(database, versionIds, assetId);
}

/** Checks published resource references against the signed-in learner's eligible school audience. */
export async function isEligibleResourceAsset(
  database: MediaAccessDatabase,
  viewer: Actor | string,
  assetId: string,
): Promise<boolean> {
  const actor = typeof viewer === 'string' ? { userId: viewer } : viewer;
  const profileResult = await database.from('profiles')
    .select('branch_id')
    .eq('id', actor.userId)
    .maybeSingle();
  if (profileResult.error) throw new Error('Media resource profile lookup failed');
  const profile = record(profileResult.data);
  if (!profile || !('branch_id' in profile)) return false;
  const branchId = await eligibleAudienceBranch(actor, profile.branch_id, database as unknown as MembershipAccessDatabase);

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

import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor, Scope } from '@/lib/authorization';
import { z } from 'zod';

type Result = { data?: unknown; error: { message?: string; code?: string; statusCode?: string | number } | null };
export type MediaDeletionDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  storage: { from(bucket: string): {
    remove(paths: string[]): PromiseLike<Result>;
    info(path: string): PromiseLike<Result>;
  } };
};
const Deletion = z.object({ id: z.string(), bucket: z.literal('media'), path: z.string().min(1), state: z.enum(['pending', 'deleted']) });
function databaseFailure(error: NonNullable<Result['error']>): never {
  if (error.code === '42501' || error.message?.includes('FORBIDDEN')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (error.message?.includes('MEDIA_NOT_FOUND')) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media asset was not found');
  if (error.message?.includes('MEDIA_IN_USE')) throw new ApiError(409, 'MEDIA_IN_USE', 'This file is used by content or retained history and cannot be deleted');
  if (error.message?.includes('MEDIA_PROTECTED') || error.message?.includes('MEDIA_REVIEW_PENDING')) throw new ApiError(409, 'MEDIA_PROTECTED', 'This file is protected by its purpose or review history');
  throw new ApiError(503, 'MEDIA_DELETE_UNAVAILABLE', 'File deletion is unavailable; try again later');
}
function storageFailure(): never {
  throw new ApiError(503, 'MEDIA_DELETE_PENDING', 'Deletion is not confirmed. The file record and storage allowance are retained; retry deletion');
}

/** The database fences all references before this service touches private Storage. */
export async function deleteMediaAsset({ database, actor, scope, assetId }: {
  database: MediaDeletionDatabase; actor: Actor; scope: Scope; assetId: string;
}) {
  const id = z.string().min(1).max(80).parse(assetId);
  const args = { p_actor: actor.userId, p_asset: id, p_scope_kind: scope.kind, p_branch_id: scope.kind === 'branch' ? scope.branchId : null };
  const begin = await database.rpc('academy_media_delete_begin', args);
  if (begin.error) databaseFailure(begin.error);
  const parsed = Deletion.safeParse(begin.data);
  if (!parsed.success || parsed.data.id !== id) throw new ApiError(503, 'MEDIA_DELETE_UNAVAILABLE', 'File deletion is unavailable');
  if (parsed.data.state === 'deleted') return { id, deleted: true };
  const { bucket, path } = parsed.data;
  try {
    const storage = database.storage.from(bucket);
    const removed = await storage.remove([path]);
    if (removed.error && String(removed.error.statusCode) !== '404') storageFailure();
    const observed = await storage.info(path);
    if (!observed.error || String(observed.error.statusCode) !== '404') storageFailure();
  } catch { storageFailure(); }
  const finished = await database.rpc('academy_media_delete_finish', args);
  if (finished.error) databaseFailure(finished.error);
  const receipt = z.object({ id: z.literal(id), state: z.literal('deleted') }).safeParse(finished.data);
  if (!receipt.success) storageFailure();
  return { id, deleted: true };
}

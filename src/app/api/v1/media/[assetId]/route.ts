import { ApiError, withHandler } from '@/lib/api';
import { isEligibleResourceAsset, isEnrolledForAsset } from '@/features/media/access';
import { canReviewProjectCover, canViewProjectCover } from '@/features/projects/service';
import { canGradeSubmissionBranch } from '@/features/submissions/permissions';
import { requireApiUser } from '@/lib/auth';
import { can, getActor, type ResourceOwner } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ assetId: string }> };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function canReadSubmissionAsset(
  database: ReturnType<typeof supabaseService>,
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  assetId: string,
  ownerId: string,
) {
  if (actor.userId === ownerId) return true;
  const filesResult = await database.from('submission_files')
    .select('user_id,submission_id')
    .eq('asset_id', assetId);
  if (filesResult.error) throw new Error('Submission file lookup failed');
  const submissionIds = (Array.isArray(filesResult.data) ? filesResult.data : []).flatMap(value => {
    const row = record(value);
    return row?.user_id === ownerId && typeof row.submission_id === 'string' ? [row.submission_id] : [];
  });
  if (!submissionIds.length) return false;
  const submissions = await database.from('assignment_submissions')
    .select('id,user_id,branch_id,branch_scope_known')
    .in('id', submissionIds).eq('user_id', ownerId);
  if (submissions.error) throw new Error('Submission history lookup failed');
  return (Array.isArray(submissions.data) ? submissions.data : []).some(value => {
    const row = record(value);
    if (row?.user_id !== ownerId || typeof row.id !== 'string' || !submissionIds.includes(row.id)) return false;
    const branchId = row.branch_scope_known === true && typeof row.branch_id === 'string' ? row.branch_id : null;
    return canGradeSubmissionBranch(actor, branchId);
  });
}

/** Redirects an authenticated caller to a short-lived URL for a private asset. */
export const GET = withHandler(async (_request, context) => {
    await requireApiUser();
    const actor = await getActor();
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');

    const { params } = context as RouteContext;
    const { assetId } = await params;
    const database = supabaseService();
    const { data, error } = await database.from('media_assets')
      .select('owner_id,bucket,path,mime,ownership_kind,owner_branch_id')
      .eq('id', assetId)
      .maybeSingle();
    if (error) throw new Error('Media lookup failed');
    if (!data || typeof data.owner_id !== 'string' || typeof data.bucket !== 'string' || typeof data.path !== 'string') {
      throw new ApiError(404, 'NOT_FOUND', 'Media not found');
    }

    // Submission assets require grading authority over the immutable submission school;
    // general Studio media permissions never grant access to learner work.
    const assetOwner: ResourceOwner | null = data.ownership_kind === 'central'
      ? { kind: 'central' }
      : data.ownership_kind === 'branch' && typeof data.owner_branch_id === 'string'
        ? { kind: 'branch', id: data.owner_branch_id }
        : null;
    const canRead = data.bucket === 'submissions'
      ? await canReadSubmissionAsset(database, actor, assetId, data.owner_id)
      : data.owner_id === actor.userId
        ? true
        : data.bucket === 'media' && (
            (assetOwner?.kind === 'central' && (
              can(actor, 'media.upload', { kind: 'central' }) || can(actor, 'content.review', { kind: 'central' })
            ))
            || (assetOwner?.kind === 'branch' && (
              can(actor, 'media.upload', { kind: 'branch', branchId: assetOwner.id })
              || can(actor, 'content.review', { kind: 'branch', branchId: assetOwner.id })
            ))
            || await canViewProjectCover(actor.userId, assetId)
            // A cover's CMS ownership need not match the project's (learner uploads
            // default to central), so reviewers and project editors can also read
            // it through the scope of a project that uses it.
            || await canReviewProjectCover(actor, assetId)
            || await isEnrolledForAsset(database, actor.userId, assetId, actor)
            || await isEligibleResourceAsset(database, actor.userId, assetId)
          );
    if (!canRead) throw new ApiError(404, 'NOT_FOUND', 'Media not found');

    const filename = data.path.split('/').pop() || 'download';
    const forceAttachment = data.bucket === 'submissions'
      && (data.mime === 'text/plain' || data.mime === 'application/json');
    const storage = database.storage.from(data.bucket);
    const { data: signed, error: signedError } = forceAttachment
      ? await storage.createSignedUrl(data.path, 60 * 60, { download: filename })
      : await storage.createSignedUrl(data.path, 60 * 60);
    if (signedError || !signed?.signedUrl) throw new Error('Media signing failed');
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed.signedUrl,
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
});

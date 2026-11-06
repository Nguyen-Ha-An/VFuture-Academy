import { grantStorageTransferUrl } from '@/features/storage-transfer/grants';
import { z } from 'zod';
import { IdSchema } from '@/content-engine/schema/common';
import { AttemptIdSchema } from '@/features/exams/http';
import { canReadHistoricalExamMedia } from '@/features/exams/historical-media';
import { createServerExamService } from '@/features/exams/server';
import { ExamError } from '@/features/exams/types';
import { ApiError, withHandler } from '@/lib/api';
import { isEligibleResourceAsset, isEnrolledForAsset } from '@/features/media/access';
import { checkBoundAssessmentOwnerAccess } from '@/features/media/assessment-owner';
import { canReviewProjectCover, canViewProjectCover } from '@/features/projects/service';
import { assertCourseTeaching } from '@/features/teaching/assignments';
import { requireApiUser } from '@/lib/auth';
import { can, getActor, type ResourceOwner } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ assetId: string }> };
const historicalQuerySchema=z.object({attemptId:AttemptIdSchema,courseId:IdSchema,itemId:IdSchema}).strict();
function historicalQuery(request:Request) {
  const params=new URL(request.url).searchParams;
  const keys=['historicalExamAttemptId','courseId','itemId'];
  if(!keys.some(key=>params.has(key))) return null;
  if(keys.some(key=>params.getAll(key).length!==1)) throw new ApiError(404,'NOT_FOUND','Media not found');
  const parsed=historicalQuerySchema.safeParse({attemptId:params.get(keys[0]),courseId:params.get(keys[1]),itemId:params.get(keys[2])});
  if(!parsed.success) throw new ApiError(404,'NOT_FOUND','Media not found');
  return parsed.data;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function canTeachVersion(
  database: ReturnType<typeof supabaseService>,
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  versionId: unknown,
  historicalBranch: unknown,
) {
  if (typeof versionId !== 'string') return false;
  const result = await database.from('course_versions').select('course_id').eq('id', versionId).maybeSingle();
  if (result.error) throw new ApiError(503, 'ATTACHMENT_SCOPE_UNAVAILABLE', 'Attachment course could not be verified');
  const courseId = record(result.data)?.course_id;
  if (typeof courseId !== 'string') return false;
  try {
    await assertCourseTeaching(actor, 'submission.grade', courseId, typeof historicalBranch === 'string' ? historicalBranch : null);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}

async function canReadSubmissionAsset(
  database: ReturnType<typeof supabaseService>,
  actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
  assetId: string,
  ownerId: string,
) {
  if (actor.userId === ownerId) {
    try {
      const assessmentAccess=await checkBoundAssessmentOwnerAccess(database,actor,assetId);
      return assessmentAccess ?? true;
    } catch(error) {
      if(error instanceof ApiError && error.status===403) return false;
      throw error;
    }
  }
  const filesResult = await database.from('submission_files')
    .select('user_id,submission_id')
    .eq('asset_id', assetId);
  if (filesResult.error) throw new Error('Submission file lookup failed');
  const submissionIds = (Array.isArray(filesResult.data) ? filesResult.data : []).flatMap(value => {
    const row = record(value);
    return row?.user_id === ownerId && typeof row.submission_id === 'string' ? [row.submission_id] : [];
  });
  if (submissionIds.length) {
    const submissions = await database.from('assignment_submissions')
      .select('id,user_id,course_version_id,branch_id,branch_scope_known')
      .in('id', submissionIds).eq('user_id', ownerId);
    if (submissions.error) throw new Error('Submission history lookup failed');
    for (const value of Array.isArray(submissions.data) ? submissions.data : []) {
      const row = record(value);
      if (row?.user_id !== ownerId || typeof row.id !== 'string' || !submissionIds.includes(row.id)) continue;
      if (await canTeachVersion(database, actor, row.course_version_id, row.branch_scope_known === true ? row.branch_id : null)) return true;
    }
  }
  const exams = await database.rpc('exam_attachment_gradeable_attempts', { p_asset: assetId, p_owner: ownerId });
  if (exams.error) throw new Error('Exam attachment lookup failed');
  for (const value of Array.isArray(exams.data) ? exams.data : []) {
    const row = record(value);
    if (typeof row?.attempt_id !== 'string') continue;
    // The gradeable-asset RPC validates pinned answer references; resolve the
    // immutable attempt itself rather than trusting an asset's current owner school.
    const result = await database.from('exam_attempts')
      .select('user_id,course_version_id,branch_id,branch_scope_known').eq('id', row.attempt_id).maybeSingle();
    if (result.error) throw new ApiError(503, 'ATTACHMENT_SCOPE_UNAVAILABLE', 'Attachment scope could not be verified');
    const attempt = record(result.data);
    if (attempt?.user_id !== ownerId) continue;
    if (await canTeachVersion(database, actor, attempt.course_version_id, attempt.branch_scope_known === true ? attempt.branch_id : null)) return true;
  }
  return false;
}

/** Redirects an authenticated caller to a short-lived URL for a private asset. */
export const GET = withHandler(async (request, context) => {
    await requireApiUser();
    const actor = await getActor();
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    const historical=historicalQuery(request);

    const { params } = context as RouteContext;
    const { assetId } = await params;
    const database = supabaseService();
    const { data, error } = await database.from('media_assets')
      .select('owner_id,bucket,path,mime,ownership_kind,owner_branch_id,size_bytes')
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
    let historicalAccess=false;
    if(historical) {
      try {
        historicalAccess=await canReadHistoricalExamMedia(createServerExamService(),{id:actor.userId,locale:'vi'},historical,assetId,{ownerId:data.owner_id,bucket:data.bucket});
      } catch(error) {
        if((error instanceof ExamError && (error.code==='FORBIDDEN' || error.code==='ATTEMPT_NOT_ACTIVE')) || (error instanceof ApiError && error.status===403)) {
          throw new ApiError(404,'NOT_FOUND','Media not found');
        }
        throw error;
      }
    }
    const canRead = historical ? historicalAccess : data.bucket === 'submissions'
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
        Location: grantStorageTransferUrl(signed.signedUrl, {
          subject: actor.userId, method: 'GET', bucket: data.bucket, path: data.path,
          maxBytes: data.size_bytes, expiresIn: 900,
        }),
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
});

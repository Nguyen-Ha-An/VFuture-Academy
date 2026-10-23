import 'server-only';

const UPLOADS_PER_WINDOW = 10;
const WINDOW_SECONDS = 60;
const SUBMISSIONS_PER_WINDOW = 10;
const SUBMISSION_WINDOW_SECONDS = 60 * 60;

type RateLimitResult = { data: unknown; error: unknown | null };

export interface UploadRateLimitDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RateLimitResult>;
}

/** Claims one upload slot from the shared, atomic per-account limiter. */
export async function permitsLearnerUpload(
  database: UploadRateLimitDatabase,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const result = await database.rpc('claim_learner_upload', {
    p_user_id: userId,
    p_now: now.toISOString(),
    p_limit: UPLOADS_PER_WINDOW,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (result.error) throw new Error('Upload rate limit unavailable');
  return result.data === true;
}

/** Claims one slot from the atomic learner-and-assignment submission limiter. */
export async function permitsAssignmentSubmission(
  database: UploadRateLimitDatabase,
  userId: string,
  courseVersionId: string,
  itemId: string,
  blockId: string | undefined,
  now = new Date(),
): Promise<boolean> {
  const result = await database.rpc('claim_assignment_submission', {
    p_user_id: userId,
    p_course_version_id: courseVersionId,
    p_item_id: itemId,
    p_block_id: blockId ?? null,
    p_now: now.toISOString(),
    p_limit: SUBMISSIONS_PER_WINDOW,
    p_window_seconds: SUBMISSION_WINDOW_SECONDS,
  });
  if (result.error) throw new Error('Submission rate limit unavailable');
  return result.data === true;
}

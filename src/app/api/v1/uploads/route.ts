import { ApiError, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

/** Retired multipart API. All learner bytes must use quota-backed reservations. */
export const POST = withHandler(async (request) => {
  await requireApiUser();
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(4 * 1024 * 1024)) {
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Use a direct upload reservation');
  }
  // Never parse multipart (including chunked requests), sign storage or insert
  // an asset here. This also closes the self-hosted quota bypass.
  throw new ApiError(410, 'DIRECT_UPLOAD_REQUIRED', 'Use a direct upload reservation');
});

import { ApiError, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { uploadMediaFile } from '@/features/media/storage';
import { isUploadedFile, MEDIA_BUCKET, parseUploadFormData } from '@/features/media/upload';
import { mediaHref } from '@/features/media/urls';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { typedContentContext } from '@/features/admin/content-review-production';

/** Accepts one allowed media file and records its private storage location. */
export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'media.upload', true);
  const actor = context.actor;
  const database = supabaseService();
  await enforceRateLimit(
    database,
    userRateLimitKey('studio:media-upload', actor.userId),
    RATE_LIMITS.upload,
    'Too many uploads; try again later',
  );
  const form = await parseUploadFormData(request);

  const file = form.get('file');
  if (!isUploadedFile(file)) throw new ApiError(400, 'INVALID_FILE', 'A media file is required');

  const stored = await uploadMediaFile(file, actor, {
    bucket: MEDIA_BUCKET,
    pathPrefix: 'media',
    purpose: 'content',
    database,
  });
  await reviews.assignOwnership('media_asset', stored.id);
  return {
    id: stored.id,
    url: mediaHref(stored.id),
    mime: stored.mime,
    sizeBytes: stored.sizeBytes,
    width: stored.width,
    height: stored.height,
  };
});

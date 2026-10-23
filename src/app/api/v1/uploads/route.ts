import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { uploadMediaFile, type MediaStorageDatabase } from '@/features/media/storage';
import { authorizeAssignmentUpload } from '@/features/submissions/service';
import {
  MEDIA_BUCKET,
  SUBMISSIONS_BUCKET,
  isUploadedFile,
  parseUploadFormData,
} from '@/features/media/upload';
import { mediaHref } from '@/features/media/urls';
import { ApiError, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const UploadContextSchema = z.object({
  courseId: IdSchema,
  itemId: IdSchema,
  blockId: IdSchema.nullable(),
}).strict();

const LEARNER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Accepts one learner-owned assignment file, profile photo, or project cover. */
export const POST = withHandler(async (request) => {
  const user = await requireApiUser();
  const database = supabaseService();
  await enforceRateLimit(
    database,
    userRateLimitKey('learner:upload', user.id),
    RATE_LIMITS.upload,
    'Too many uploads; try again later',
  );
  const form = await parseUploadFormData(request);
  const file = form.get('file');
  if (!isUploadedFile(file)) throw new ApiError(400, 'INVALID_FILE', 'A file is required');
  const purpose = form.get('purpose');
  if (purpose !== null && purpose !== 'avatar' && purpose !== 'project_cover') {
    throw new ApiError(400, 'INVALID_UPLOAD_PURPOSE', 'Upload purpose is invalid');
  }
  if (purpose === 'project_cover') {
    if (!LEARNER_IMAGE_TYPES.includes(file.type)) {
      throw new ApiError(415, 'UNSUPPORTED_PROJECT_COVER', 'Project cover must be a JPEG, PNG, or WebP image');
    }
    // The cover stays unattached until a proposal or Studio save references it;
    // project services verify ownership and purpose at that point.
    const stored = await uploadMediaFile(file, { userId: user.id, roles: [] }, {
      bucket: MEDIA_BUCKET,
      pathPrefix: `${user.id}/project-cover`,
      purpose: 'project_cover',
      database: database as unknown as MediaStorageDatabase,
    });
    return {
      assetId: stored.id,
      url: mediaHref(stored.id),
      name: stored.filename,
      size: stored.sizeBytes,
      mime: stored.mime,
    };
  }
  if (purpose === 'avatar') {
    if (!LEARNER_IMAGE_TYPES.includes(file.type)) {
      throw new ApiError(415, 'UNSUPPORTED_AVATAR', 'Profile photo must be a JPEG, PNG, or WebP image');
    }
    const stored = await uploadMediaFile(file, { userId: user.id, roles: [] }, {
      bucket: MEDIA_BUCKET,
      pathPrefix: `${user.id}/avatar`,
      purpose: 'avatar',
      database: database as unknown as MediaStorageDatabase,
    });
    const profileQuery = database.from('profiles') as unknown as {
      update(value: unknown): { eq(column: string, value: unknown): PromiseLike<{ error: unknown | null }> };
    };
    const profileResult = await profileQuery.update({ avatar_url: mediaHref(stored.id) }).eq('id', user.id);
    if (profileResult.error) throw new ApiError(500, 'DATABASE_ERROR', 'Profile photo could not be saved');
    return {
      assetId: stored.id,
      url: mediaHref(stored.id),
      name: stored.filename,
      size: stored.sizeBytes,
      mime: stored.mime,
    };
  }
  const context = UploadContextSchema.parse({
    courseId: form.get('courseId'),
    itemId: form.get('itemId'),
    blockId: form.get('blockId'),
  });
  await authorizeAssignmentUpload(
    { userId: user.id, roles: [] },
    { courseId: context.courseId, itemId: context.itemId, blockId: context.blockId },
    { size: file.size, mime: file.type },
  );

  const stored = await uploadMediaFile(file, { userId: user.id, roles: [] }, {
    bucket: SUBMISSIONS_BUCKET,
    pathPrefix: user.id,
    purpose: 'submission',
    itemId: context.itemId,
    database: database as unknown as MediaStorageDatabase,
  });
  return {
    assetId: stored.id,
    name: stored.filename,
    size: stored.sizeBytes,
    mime: stored.mime,
  };
});

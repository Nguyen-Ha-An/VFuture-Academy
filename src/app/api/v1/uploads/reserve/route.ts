import { z } from 'zod';
import { cleanupDirectUploads, reserveDirectUpload, type DirectUploadDatabase } from '@/features/media/direct-upload';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

export const POST = withHandler(async (request) => {
  const user = await requireApiUser();
  const database = supabaseService();
  await enforceRateLimit(database, userRateLimitKey('learner:upload', user.id), RATE_LIMITS.upload, 'Too many uploads; try again later');
  const input = await parseBody(z.unknown(), request, { maxBytes: 4096 });
  await cleanupDirectUploads(database as unknown as DirectUploadDatabase, 2);
  return reserveDirectUpload(user.id, input, database as unknown as DirectUploadDatabase);
});

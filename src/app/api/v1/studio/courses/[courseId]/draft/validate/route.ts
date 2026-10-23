import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { validateDraft } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { scopedContentContext } from '@/features/admin/content-review-production';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const ValidateBody = z.object({ publish: z.boolean().optional().default(false) }).strict();

async function courseIdOf(context: unknown) {
  const params = await Promise.resolve((context as { params?: Record<string, string> | Promise<Record<string, string>> })?.params ?? {});
  return IdSchema.parse(params.courseId);
}

export const POST = withHandler(async (request, context) => {
  const courseId = await courseIdOf(context);
  const { context: admin } = await scopedContentContext(request, 'course', courseId, 'content.read', 'course.read', true);
  const actor = admin.actor;
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('studio:course-validate', actor.userId),
    RATE_LIMITS.validation,
  );
  // The body used to go through a bare JSON.parse, which quietly accepted what the
  // rest of the pipeline rejects. Every Studio content route now shares one strict
  // reader.
  const raw = await readStrictJsonBodyLimited(request, { emptyAsObject: true });
  return validateDraft(courseId, ValidateBody.parse(raw));
});

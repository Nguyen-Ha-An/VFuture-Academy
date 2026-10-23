import { z } from 'zod';

import { contentReviewContext } from '@/features/admin/content-review-production';
import { prepareCoursePublication, PublishChecklistSchema } from '@/features/studio/drafts';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';

type Context = { params: Promise<{ reviewId: string }> };
const RequestSchema = z.object({
  expectedRevision: z.string().min(1),
  note: z.string().trim().min(1).max(4000),
  checklist: PublishChecklistSchema.optional(),
}).strict();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export const POST = withHandler(async (request, routeContext) => {
  const { service } = await contentReviewContext(request, 'content.publish', true);
  const { reviewId } = await (routeContext as Context).params;
  const body = await parseBody(RequestSchema, request);
  const candidate = record(await service.approvalCandidate(reviewId));
  const contentType = candidate?.contentType;
  const contentId = candidate?.contentId;
  const status = candidate?.status;
  if (typeof contentType !== 'string' || typeof contentId !== 'string' || typeof status !== 'string') {
    throw new ApiError(500, 'CMS_DATABASE_ERROR', 'Review approval candidate is invalid');
  }
  let prepared: unknown | null = null;
  if (contentType === 'course' && status !== 'published') {
    if (!body.checklist) throw new ApiError(422, 'CMS_COURSE_CHECKLIST_REQUIRED', 'The course publication checklist is required');
    prepared = await prepareCoursePublication(
      contentId,
      { checklist: body.checklist, notes: body.note },
      undefined,
      body.expectedRevision,
    );
  } else if (contentType !== 'course' && body.checklist) {
    throw new ApiError(400, 'CMS_COURSE_CHECKLIST_UNEXPECTED', 'The course checklist is valid only for course publication');
  }
  return ok(await service.approveAndPublish(
    reviewId,
    body.expectedRevision,
    body.note,
    prepared,
  ), { headers: { 'cache-control': 'private, no-store' } });
});

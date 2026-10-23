import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { QUEUE_STATUS_FILTERS, queue } from '@/features/submissions/service';
import { requireSubmissionGrader } from '@/features/submissions/route-auth';
import { withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

const QueueQuerySchema = z.object({
  branchId: z.string().min(1).max(100).optional(),
  courseId: IdSchema.optional(),
  assignmentId: IdSchema.optional(),
  status: z.enum(QUEUE_STATUS_FILTERS).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).strict();

export const GET = withHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const filter = QueueQuerySchema.parse({
    branchId: params.get('branchId') ?? undefined,
    courseId: params.get('courseId') ?? undefined,
    assignmentId: params.get('assignmentId') ?? undefined,
    status: params.get('status') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  });
  const actor = filter.branchId
    ? await requirePermission('submission.grade', { branchId: filter.branchId })
    : await requireSubmissionGrader();
  return queue(actor, filter);
});

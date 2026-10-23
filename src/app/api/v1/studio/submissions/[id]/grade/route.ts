import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { GradeSubmissionSchema, grade } from '@/features/submissions/service';
import { requireSubmissionGrader } from '@/features/submissions/route-auth';
import { parseBody, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withHandler(async (request, context) => {
  const branchId = z.string().min(1).max(100).optional().parse(
    new URL(request.url).searchParams.get('branchId') ?? undefined,
  );
  const actor = branchId
    ? await requirePermission('submission.grade', { branchId })
    : await requireSubmissionGrader();
  const submissionId = IdSchema.parse((await (context as RouteContext).params).id);
  const input = await parseBody(GradeSubmissionSchema, request);
  return grade(actor, submissionId, input);
});

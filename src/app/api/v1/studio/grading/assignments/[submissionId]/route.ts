import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { createServerGradingDetailService } from '@/features/grading/detail';
import { requireSubmissionGrader } from '@/features/submissions/route-auth';
import { ok, withHandler } from '@/lib/api';

type RouteContext = { params: Promise<{ submissionId: string }> };

const QuerySchema = z.object({
  branchId: z.string().min(1).max(100).optional(),
  locale: z.enum(['vi', 'en']).default('vi'),
}).strict();

export const GET = withHandler(async (request, context) => {
  const params = new URL(request.url).searchParams;
  const query = QuerySchema.parse({
    branchId: params.get('branchId') ?? undefined,
    locale: params.get('locale') ?? undefined,
  });
  const actor = await requireSubmissionGrader(query.branchId);
  const submissionId = IdSchema.parse((await (context as RouteContext).params).submissionId);
  return ok(await createServerGradingDetailService().assignment(
    actor,
    submissionId,
    query.branchId,
    query.locale,
  ));
});

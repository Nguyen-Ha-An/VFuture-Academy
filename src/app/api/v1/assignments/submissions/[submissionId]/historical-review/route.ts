import { z } from 'zod';
import { IdSchema, LocaleSchema } from '@/content-engine';
import { getAssignmentHistoricalReview } from '@/features/submissions/history';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const Query = z.object({ courseId: IdSchema, itemId: IdSchema, locale: LocaleSchema.default('vi') }).strict();
export const GET = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const params = await (context as { params: Promise<{ submissionId: string }> }).params;
  const submissionId = z.uuid().parse(params.submissionId);
  const { locale, ...locator } = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  return ok(await getAssignmentHistoricalReview({ userId: user.id, roles: [] }, { ...locator, submissionId }, locale),
    { headers: { 'Cache-Control': 'private, no-store' } });
});

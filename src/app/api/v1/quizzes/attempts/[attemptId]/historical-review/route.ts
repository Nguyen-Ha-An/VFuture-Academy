import { z } from 'zod';
import { IdSchema, LocaleSchema } from '@/content-engine';
import { getQuizHistoricalReview } from '@/features/quizzes/history';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const Query = z.object({ courseId: IdSchema, itemId: IdSchema, locale: LocaleSchema.default('vi') }).strict();
export const GET = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const params = await (context as { params: Promise<{ attemptId: string }> }).params;
  const attemptId = z.uuid().parse(params.attemptId);
  const { locale, ...locator } = Query.parse(Object.fromEntries(new URL(request.url).searchParams));
  return ok(await getQuizHistoricalReview({ userId: user.id, roles: [] }, { ...locator, attemptId }, locale),
    { headers: { 'Cache-Control': 'private, no-store' } });
});

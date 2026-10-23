import { z } from 'zod';

import { IdSchema, LocaleSchema } from '@/content-engine';
import { getItemPayload } from '@/features/progress/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const ItemQuerySchema = z.object({ locale: LocaleSchema.default('vi') }).strict();

export const GET = withHandler(async (request, context?: unknown) => {
  const user = await requireApiUser();
  const params = await (context as { params: Promise<{ courseId: string; itemId: string }> }).params;
  const courseId = IdSchema.parse(params.courseId);
  const itemId = IdSchema.parse(params.itemId);
  const locale = ItemQuerySchema.parse({
    locale: new URL(request.url).searchParams.get('locale') ?? undefined,
  }).locale;
  return ok(await getItemPayload({ userId: user.id, roles: [] }, courseId, itemId, locale));
});

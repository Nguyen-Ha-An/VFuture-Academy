import { z } from 'zod';

import { IdSchema, LocaleSchema } from '@/content-engine/schema/common';
import { visibleStudioDraft } from '@/features/studio/source-access';
import { buildDraftPrompt } from '@/features/studio/prompts';
import { ok, withHandler } from '@/lib/api';
import { typedContentContext } from '@/features/admin/content-review-production';

const KindSchema = z.enum(['outline', 'lesson', 'exam', 'quiz', 'translate']);

export const GET = withHandler(async (request) => {
  const query = new URL(request.url).searchParams;
  const courseId = IdSchema.parse(query.get('courseId'));
  const kind = KindSchema.parse(query.get('kind'));
  const itemId = IdSchema.optional().parse(query.get('itemId') ?? undefined);
  const locale = LocaleSchema.parse(query.get('locale') ?? 'vi');
  const { context } = await typedContentContext(request, 'content.read', 'course.read');
  const { draft } = await visibleStudioDraft(context, courseId);
  const prompt = buildDraftPrompt(draft, { kind, itemId, locale });
  return ok({ prompt }, { headers: { 'cache-control': 'private, no-store' } });
});

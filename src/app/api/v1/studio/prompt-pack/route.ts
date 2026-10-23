import { z } from 'zod';

import { IdSchema, LocaleSchema } from '@/content-engine/schema/common';
import { getDraft } from '@/features/studio/drafts';
import { buildDraftPrompt } from '@/features/studio/prompts';
import { withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';

const KindSchema = z.enum(['outline', 'lesson', 'exam', 'quiz', 'translate']);

export const GET = withHandler(async (request) => {
  await requirePermission('course.read');
  const query = new URL(request.url).searchParams;
  const courseId = IdSchema.parse(query.get('courseId'));
  const kind = KindSchema.parse(query.get('kind'));
  const itemId = IdSchema.optional().parse(query.get('itemId') ?? undefined);
  const locale = LocaleSchema.parse(query.get('locale') ?? 'vi');
  const draft = await getDraft(courseId);
  return { prompt: buildDraftPrompt(draft, { kind, itemId, locale }) };
});

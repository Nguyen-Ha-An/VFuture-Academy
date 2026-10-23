import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { session } from '@/features/submissions/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

type RouteContext = { params: Promise<{ itemId: string }> };

const MineQuerySchema = z.object({
  courseId: IdSchema,
  itemId: IdSchema,
  blockId: IdSchema.nullable(),
}).strict();

export const GET = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { itemId } = await (context as RouteContext).params;
  const courseId = new URL(request.url).searchParams.get('courseId');
  const blockId = new URL(request.url).searchParams.get('blockId');
  const input = MineQuerySchema.parse({ courseId, itemId, blockId });
  return session(
    { userId: user.id, roles: [] },
    { courseId: input.courseId, itemId: input.itemId, blockId: input.blockId },
  );
});

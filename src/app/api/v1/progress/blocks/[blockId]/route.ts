import { z } from 'zod';

import { IdSchema } from '@/content-engine';
import { putBlockState, recompute } from '@/features/progress/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import type { Actor } from '@/lib/permissions';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const BlockStateBodySchema = z.object({
  courseId: IdSchema,
  itemId: IdSchema,
  state: JsonValueSchema,
  completed: z.boolean(),
}).strict().refine(
  ({ state }) => new TextEncoder().encode(JSON.stringify(state)).byteLength <= 16 * 1024,
  { path: ['state'], message: 'Block state must not exceed 16 KiB' },
);

const handleBlockState = withHandler(async (request, context?: unknown) => {
  const user = await requireApiUser();
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('progress:mutation', user.id),
    RATE_LIMITS.progress,
    'Too many progress updates',
  );
  const actor: Actor = { userId: user.id, roles: [] };
  const { blockId } = await (context as { params: Promise<{ blockId: string }> }).params;
  const parsedBlockId = IdSchema.parse(blockId);
  const body = await parseBody(BlockStateBodySchema, request);
  const state = await putBlockState(
    actor,
    body.courseId,
    body.itemId,
    parsedBlockId,
    body.state,
    body.completed,
  );
  const completion = body.completed ? await recompute(actor, body.courseId) : null;
  return ok({ state, completion });
});

export const PUT = handleBlockState;
export const POST = handleBlockState;

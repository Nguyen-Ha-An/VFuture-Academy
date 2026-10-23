import { z } from 'zod';

import { createQuizService, type QuizDatabase } from '@/features/quizzes/service';
import { learnerQuizActor } from '@/features/quizzes/server';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser as requireUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const questionIdSchema = z.string().min(1).max(194)
  .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/);
const answerPrimitiveSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const answerArraySchema = z.array(answerPrimitiveSchema).max(200);
const answerLeafRecordSchema = z.record(
  z.string().min(1).max(194),
  z.union([answerPrimitiveSchema, answerArraySchema]),
).refine((answer) => Object.keys(answer).length <= 200, 'Too many answer fields');
const answerRecordSchema = z.record(
  z.string().min(1).max(194),
  z.union([answerPrimitiveSchema, answerArraySchema, answerLeafRecordSchema]),
).refine((answer) => Object.keys(answer).length <= 200, 'Too many answer fields');
const answerValueSchema = z.union([
  answerPrimitiveSchema,
  answerArraySchema,
  answerRecordSchema,
]);
const bodySchema = z.object({
  courseId: idSchema,
  itemId: idSchema,
  quizId: idSchema,
  questionId: questionIdSchema,
  answer: answerValueSchema,
}).strict();

export const POST = withHandler(async (request) => {
  const user = await requireUser();
  const body = await parseBody(bodySchema, request);
  const database = supabaseService();
  await enforceRateLimit(
    database,
    userRateLimitKey(`quiz:check:${body.quizId}`, user.id),
    RATE_LIMITS.quizCheck,
    'Too many quiz requests; try again later',
  );
  const service = createQuizService({
    database: database as unknown as QuizDatabase,
  });
  return service.check(
    await learnerQuizActor(database as unknown as QuizDatabase, user.id),
    body.courseId,
    body.itemId,
    body.quizId,
    body.questionId,
    body.answer,
  );
});

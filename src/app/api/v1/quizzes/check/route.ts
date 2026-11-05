import { z } from 'zod';
import { AnswerValueSchema } from '@/features/learning/answer-input';

import { createQuizService, type QuizDatabase } from '@/features/quizzes/service';
import { learnerQuizActor } from '@/features/quizzes/server';
import { validateQuizAnswerAttachments } from '@/features/quizzes/attachments';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser as requireUser } from '@/lib/auth';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const questionIdSchema = z.string().min(1).max(194)
  .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/);
const bodySchema = z.object({
  courseId: idSchema,
  itemId: idSchema,
  quizId: idSchema,
  questionId: questionIdSchema,
  answer: AnswerValueSchema,
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
    validateQuizAnswerAttachments,
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

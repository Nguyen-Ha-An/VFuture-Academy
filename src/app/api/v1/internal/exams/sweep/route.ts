import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { createServerExamService } from '@/features/exams/server';
import { ApiError, withHandler } from '@/lib/api';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function suppliedSecret(request: Request) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
  return request.headers.get('x-cron-secret') ?? request.headers.get('cron-secret') ?? '';
}

function requireCronSecret(request: Request) {
  const expected = z.string().min(1).safeParse(process.env.CRON_SECRET);
  const supplied = suppliedSecret(request);
  const authorized = expected.success && timingSafeEqual(digest(supplied), digest(expected.data));
  if (!authorized) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
}

export const POST = withHandler(async (request) => {
  requireCronSecret(request);
  return createServerExamService().sweepExpired();
});

// Vercel Cron invokes configured paths with GET. Keep POST for explicit
// internal callers while exposing the identical protected handler to the scheduler.
export const GET = POST;

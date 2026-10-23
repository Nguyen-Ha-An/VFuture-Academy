import { z } from 'zod';

import { actorPermissionCheck, bankFiltersFromUrl, createBankService, type BankDatabase } from '@/features/bank/service';
import { fail, ok, toValidationIssues, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { type Actor, type Scope } from '@/lib/permissions';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';
import { typedContentContext } from '@/features/admin/content-review-production';

function serviceFor(actor: Actor, scope?: Scope) {
  return createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: actorPermissionCheck(actor, scope),
    scope,
  });
}

export const GET = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.read', 'bank.edit');
  const actor = context.actor;
  let filters;
  try {
    filters = bankFiltersFromUrl(request.url);
  } catch (error) {
    if (error instanceof z.ZodError) return fail(400, 'VALIDATION_ERROR', 'Invalid question bank filters', toValidationIssues(error.issues));
    throw error;
  }
  return ok(await serviceFor(actor, context.scope).list(filters));
});

export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'bank.edit', true);
  const actor = context.actor;
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('studio:bank-import', actor.userId),
    RATE_LIMITS.import,
  );
  // Authored content: read strictly, so a duplicate key or a BOM is rejected here
  // rather than silently normalised by JSON.parse before anything can point at it.
  const document = await readStrictJsonBodyLimited(request);
  const result = await serviceFor(actor, context.scope).importBundle(document);
  for (const row of result) {
    if (typeof row === 'object' && row !== null && 'id' in row) await reviews.assignOwnership('bank_question', String(row.id));
  }
  return ok(result, { status: 201 });
});

import { actorPermissionCheck, createBankService, type BankDatabase } from '@/features/bank/service';
import { ok, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { requirePermission } from '@/lib/permissions';
import { RATE_LIMITS, enforceRateLimit, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

export const POST = withHandler(async (request) => {
  const actor = await requirePermission('bank.edit');
  await enforceRateLimit(
    supabaseService(),
    userRateLimitKey('studio:bank-validate', actor.userId),
    RATE_LIMITS.validation,
  );
  const service = createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: actorPermissionCheck(actor),
  });
  return ok(await service.validate(await readStrictJsonBodyLimited(request)));
});

import { learnerContext, requestLocale } from '@/features/ecosystem/context';
import { createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

export const GET = withHandler(async (request, routeContext) => {
  const user = await requireApiUser();
  const locale = await requestLocale(request);
  const context = await learnerContext(user.id, locale);
  const { id } = await (routeContext as Context).params;
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: async () => { throw new Error('Learner routes cannot mutate opportunities'); },
  });
  return ok(await service.get(id, context));
});

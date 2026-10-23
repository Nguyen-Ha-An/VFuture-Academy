import { z } from 'zod';

import { learnerContext, requestLocale } from '@/features/ecosystem/context';
import { createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

const InterestSchema = z.object({ interested: z.boolean() }).strict();

export const PUT = withHandler(async (request, routeContext) => {
  const user = await requireApiUser();
  const locale = await requestLocale(request);
  const context = await learnerContext(user.id, locale);
  const { id } = await (routeContext as Context).params;
  const { interested } = await parseBody(InterestSchema, request, { maxBytes: 4 * 1024 });
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: async () => { throw new Error('Learner routes cannot mutate opportunity records'); },
  });
  return ok(await service.setInterest(id, interested, context));
});

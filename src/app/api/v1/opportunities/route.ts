import { z } from 'zod';

import { learnerContext, requestLocale } from '@/features/ecosystem/context';
import { createOpportunityService, opportunityFiltersFromUrl, type OpportunityDatabase } from '@/features/opportunities/service';
import { fail, ok, toValidationIssues, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const locale = await requestLocale(request);
  let filters;
  try {
    filters = opportunityFiltersFromUrl(request.url);
  } catch (error) {
    if (error instanceof z.ZodError) return fail(400, 'VALIDATION_ERROR', 'Invalid opportunity filters', toValidationIssues(error.issues));
    throw error;
  }
  const context = await learnerContext(user.id, locale);
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: async () => { throw new Error('Learner routes cannot mutate opportunities'); },
  });
  return ok(await service.listPage(filters, context));
});

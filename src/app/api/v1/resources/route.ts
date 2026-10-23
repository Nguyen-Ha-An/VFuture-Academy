import { z } from 'zod';

import { learnerContext, requestLocale } from '@/features/ecosystem/context';
import { createResourceService, resourceFiltersFromUrl, type ResourceDatabase } from '@/features/resources/service';
import { fail, ok, toValidationIssues, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const locale = await requestLocale(request);
  let filters;
  try {
    filters = resourceFiltersFromUrl(request.url);
  } catch (error) {
    if (error instanceof z.ZodError) return fail(400, 'VALIDATION_ERROR', 'Invalid resource filters', toValidationIssues(error.issues));
    throw error;
  }
  const context = await learnerContext(user.id, locale);
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: async () => { throw new Error('Learner routes cannot mutate resources'); },
  });
  return ok(await service.listPage(filters, context));
});

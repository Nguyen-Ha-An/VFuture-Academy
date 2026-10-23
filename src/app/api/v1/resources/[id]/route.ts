import { learnerContext, requestLocale } from '@/features/ecosystem/context';
import { createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

export const GET = withHandler(async (request, routeContext) => {
  const user = await requireApiUser();
  const locale = await requestLocale(request);
  const context = await learnerContext(user.id, locale);
  const { id } = await (routeContext as Context).params;
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: async () => { throw new Error('Learner routes cannot mutate resources'); },
  });
  return ok(await service.get(id, context));
});

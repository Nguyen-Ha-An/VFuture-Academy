import { z } from 'zod';

import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ApiError, ok, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { requirePermission } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

const ValidateSchema = z.object({ document: z.unknown() }).strict();

export const POST = withHandler(async (request, routeContext) => {
  const actor = await requirePermission('resource.edit');
  const { id } = await (routeContext as Context).params;
  const { document } = ValidateSchema.parse(await readStrictJsonBodyLimited(request));
  if (typeof document === 'object' && document !== null && 'id' in document && document.id !== id) {
    throw new ApiError(400, 'ID_MISMATCH', 'Resource id must match the route id');
  }
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(actor),
  });
  return ok(await service.validate(id, document));
});

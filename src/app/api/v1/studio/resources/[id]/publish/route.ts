import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ok, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { z } from 'zod';
import { parseBody } from '@/lib/api';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';

type Context = { params: Promise<{ id: string }> };

const PublishSchema = z.object({
  document: z.unknown(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const POST = withHandler(async (request, routeContext) => {
  const { context } = await typedContentContext(request, 'content.publish', 'resource.publish', true);
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'resource', id, 'content.read');
  const body = await parseBody(PublishSchema, request);
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const result = await service.publish(id, body);
  invalidatePublicCache('resources');
  return ok(result);
});

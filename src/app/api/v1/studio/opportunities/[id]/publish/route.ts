import { z } from 'zod';

import { actorOpportunityPermissionCheck, createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';

type Context = { params: Promise<{ id: string }> };

const PublishSchema = z.object({
  document: z.unknown(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const POST = withHandler(async (request, routeContext) => {
  const { context } = await typedContentContext(request, 'content.publish', 'opportunity.publish', true);
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'opportunity', id, 'content.read');
  const body = await parseBody(PublishSchema, request);
  if (typeof body.document === 'object' && body.document !== null && 'id' in body.document && body.document.id !== id) {
    throw new ApiError(400, 'ID_MISMATCH', 'Opportunity id must match the route id');
  }
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: actorOpportunityPermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const result = await service.publish(id, {
    document: body.document,
    expectedUpdatedAt: body.expectedUpdatedAt,
  });
  invalidatePublicCache('opportunities');
  return ok(result);
});

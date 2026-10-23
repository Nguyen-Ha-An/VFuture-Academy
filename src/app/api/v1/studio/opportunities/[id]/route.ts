import { z } from 'zod';

import { actorOpportunityPermissionCheck, createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';
import type { Scope } from '@/lib/permissions';

type Context = { params: Promise<{ id: string }> };

const DraftEnvelopeSchema = z.object({
  document: z.unknown(),
  unpublish: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

function serviceFor(actor: Awaited<ReturnType<typeof requirePermission>>, scope?: Scope) {
  return createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: actorOpportunityPermissionCheck(actor, scope),
    scope,
  });
}

export const GET = withHandler(async (_request, routeContext) => {
  const { context } = await typedContentContext(_request, 'content.read', 'opportunity.edit');
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'opportunity', id, 'content.read');
  return ok(await serviceFor(actor, context.scope).getStudio(id));
});

export const PUT = withHandler(async (request, routeContext) => {
  const { context } = await typedContentContext(request, 'content.edit', 'opportunity.edit', true);
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'opportunity', id, 'content.edit');
  const body = await parseBody(z.unknown(), request);
  const envelope = DraftEnvelopeSchema.safeParse(body);
  const document = envelope.success ? envelope.data.document : body;
  if (typeof document === 'object' && document !== null && 'id' in document && document.id !== id) {
    throw new ApiError(400, 'ID_MISMATCH', 'Opportunity id must match the route id');
  }
  const result = await serviceFor(actor, context.scope).saveDraft(
    document,
    ...(envelope.success ? [{
      unpublish: envelope.data.unpublish === true,
      ...(envelope.data.expectedUpdatedAt ? { expectedUpdatedAt: envelope.data.expectedUpdatedAt } : {}),
    }] : []),
  );
  if (envelope.success && envelope.data.unpublish === true) invalidatePublicCache('opportunities');
  return ok(result);
});

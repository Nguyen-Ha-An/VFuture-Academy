import { z } from 'zod';

import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ApiError, ok, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { requirePermission, type Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';

type Context = { params: Promise<{ id: string }> };

const DraftEnvelopeSchema = z.object({
  document: z.unknown(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  unpublish: z.boolean().optional(),
}).strict();

function serviceFor(actor: Awaited<ReturnType<typeof requirePermission>>, scope?: Scope) {
  return createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(actor, scope),
    scope,
  });
}

export const GET = withHandler(async (_request, routeContext) => {
  const request = _request;
  const { context } = await typedContentContext(request, 'content.read', 'resource.edit');
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'resource', id, 'content.read');
  return ok(await serviceFor(actor, context.scope).getStudio(id));
});

export const PUT = withHandler(async (request, routeContext) => {
  const { context } = await typedContentContext(request, 'content.edit', 'resource.edit', true);
  const actor = context.actor;
  const { id } = await (routeContext as Context).params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'resource', id, 'content.edit');
  const envelope = DraftEnvelopeSchema.parse(await readStrictJsonBodyLimited(request));
  const document = envelope.document;
  if (typeof document === 'object' && document !== null && 'id' in document && document.id !== id) {
    throw new ApiError(400, 'ID_MISMATCH', 'Resource id must match the route id');
  }
  const result = await serviceFor(actor, context.scope).saveDraft(
    document,
    { unpublish: envelope.unpublish === true, expectedUpdatedAt: envelope.expectedUpdatedAt },
  );
  if (envelope.unpublish === true) invalidatePublicCache('resources');
  return ok(result);
});

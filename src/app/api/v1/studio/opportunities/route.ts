import { z } from 'zod';

import { actorOpportunityPermissionCheck, createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { typedContentContext } from '@/features/admin/content-review-production';

const DraftEnvelopeSchema = z.object({
  document: z.unknown(),
  unpublish: z.boolean().optional(),
}).strict();

const PageSchema = z.coerce.number().int().min(1).max(10_000);

export const GET = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.read', 'opportunity.edit');
  const actor = context.actor;
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: actorOpportunityPermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const page = PageSchema.parse(new URL(request.url).searchParams.get('page') ?? '1');
  return ok(await service.listStudio(page));
});

export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'opportunity.edit', true);
  const actor = context.actor;
  const body = await parseBody(z.unknown(), request);
  const envelope = DraftEnvelopeSchema.safeParse(body);
  const document = envelope.success ? envelope.data.document : body;
  const service = createOpportunityService({
    database: supabaseService() as unknown as OpportunityDatabase,
    requirePermission: actorOpportunityPermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const result = await service.saveDraft(
    document,
    { ...(envelope.success ? { unpublish: envelope.data.unpublish === true } : {}), createOnly: true },
  );
  const id = typeof result === 'object' && result !== null && 'id' in result ? String(result.id) : '';
  if (id) await reviews.assignOwnership('opportunity', id);
  if (envelope.success && envelope.data.unpublish === true) invalidatePublicCache('opportunities');
  return ok(result, { status: 201 });
});

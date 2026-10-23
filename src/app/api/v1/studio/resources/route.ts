import { actorResourcePermissionCheck, createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ok, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { supabaseService } from '@/lib/supabase/server';
import { z } from 'zod';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { typedContentContext } from '@/features/admin/content-review-production';

const DraftEnvelopeSchema = z.object({
  document: z.unknown(),
  unpublish: z.boolean().optional(),
}).strict();

const PageSchema = z.coerce.number().int().min(1).max(10_000);

export const GET = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.read', 'resource.edit');
  const actor = context.actor;
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const page = PageSchema.parse(new URL(request.url).searchParams.get('page') ?? '1');
  return ok(await service.listStudio(page));
});

export const POST = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.create', 'resource.edit', true);
  const actor = context.actor;
  // Authored content: read strictly, so a duplicate key or a BOM is rejected here
  // rather than silently normalised by JSON.parse before anything can point at it.
  const body = await readStrictJsonBodyLimited(request);
  const envelope = DraftEnvelopeSchema.safeParse(body);
  const document = envelope.success ? envelope.data.document : body;
  const service = createResourceService({
    database: supabaseService() as unknown as ResourceDatabase,
    requirePermission: actorResourcePermissionCheck(actor, context.scope),
    scope: context.scope,
  });
  const result = await service.saveDraft(
    document,
    { ...(envelope.success ? { unpublish: envelope.data.unpublish === true } : {}), createOnly: true },
  );
  if (envelope.success && envelope.data.unpublish === true) invalidatePublicCache('resources');
  return ok(result, { status: 201 });
});

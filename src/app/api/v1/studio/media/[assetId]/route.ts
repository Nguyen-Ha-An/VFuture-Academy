import { z } from 'zod';

import { MediaAltSchema } from '@/features/media/library';
import { ok, parseBody, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { typedContentContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';

type RouteContext = { params: Promise<{ assetId: string }> };

const UpdateAltBody = z.object({ alt: MediaAltSchema, expectedRevision: z.string().min(1) }).strict();

export const GET = withHandler(async (request, context) => {
  const { assetId } = await (context as RouteContext).params;
  const { context: admin, service } = await typedContentContext(request, 'content.read', 'media.upload');
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, admin.actor, 'media_asset', assetId, 'content.read');
  return ok(await service.mediaEditorState(assetId), { headers: { 'cache-control': 'private, no-store' } });
});

export const PUT = withHandler(async (request, context) => {
  const { assetId } = await (context as RouteContext).params;
  const { context: admin, service } = await typedContentContext(request, 'content.edit', 'media.upload', true);
  const actor = admin.actor;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'media_asset', assetId, 'content.edit');
  const { alt, expectedRevision } = await parseBody(UpdateAltBody, request);
  return ok(await service.saveMediaAlt(assetId, expectedRevision, alt));
});

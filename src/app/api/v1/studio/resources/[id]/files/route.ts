import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';
import { academyFilesWritesEnabled, createResourceFilesPilot, isAcademyFilesPilot, readAcademyPilotPdf } from '@/features/resources/files-pilot';
import { type ResourceDatabase } from '@/features/resources/service';
import { assertWorkspacePermission } from '@/features/workspace/context';
import { ApiError, ok, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

async function authorize(request: Request, routeContext: unknown, mutation: boolean) {
  const { context } = await typedContentContext(request, 'content.publish', 'resource.publish', mutation);
  if (context.scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  assertWorkspacePermission(context, 'resource.edit');
  const { id } = await (routeContext as Context).params;
  const database = supabaseService();
  await assertContentAccess(database as unknown as ContentReviewDatabase, context.actor, 'resource', id, 'content.edit');
  return { id, actorId: context.actor.userId, pilot: createResourceFilesPilot(database as unknown as ResourceDatabase) };
}

const privateResponse = { headers: { 'Cache-Control': 'private, no-store' } };

export const GET = withHandler(async (request, routeContext) => {
  const { id, pilot } = await authorize(request, routeContext, false);
  return ok(await pilot.status(id), privateResponse);
});

export const POST = withHandler(async (request, routeContext) => {
  const { id, actorId, pilot } = await authorize(request, routeContext, true);
  if (!isAcademyFilesPilot(id) || !academyFilesWritesEnabled()) {
    throw new ApiError(404, 'FILES_RESOURCE_UNAVAILABLE', 'The Academy PDF pilot is unavailable for this resource');
  }
  return ok(await pilot.submit(id, actorId, await readAcademyPilotPdf(request)), privateResponse);
});

export const PATCH = withHandler(async (request, routeContext) => {
  const { id, pilot } = await authorize(request, routeContext, true);
  return ok(await pilot.refresh(id), privateResponse);
});

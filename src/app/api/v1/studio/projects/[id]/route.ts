import {
  ProjectInputSchema,
  createProjectService,
  createSupabaseProjectStore,
  actorPermissionCheck,
  type ProjectDatabase,
} from '@/features/projects/service';
import { ApiError, fail, ok, parseBody, withHandler } from '@/lib/api';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { scopedContentContext } from '@/features/admin/content-review-production';
import { type AdminContext } from '@/features/admin/context';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

function projectService(context: AdminContext) {
  return createProjectService({
    store: createSupabaseProjectStore(supabaseService() as unknown as ProjectDatabase),
    authorize: actorPermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
}

export const GET = withHandler(async (_request, context) => {
  const { id } = await (context as RouteContext).params;
  if (!id) return fail(400, 'PROJECT_ID_REQUIRED', 'Project id is required');
  const { context: admin } = await scopedContentContext(_request, 'project', id, 'content.read', 'project.edit');
  return ok(await projectService(admin).getStudio(id));
});

export const PUT = withHandler(async (request, context) => {
  const { id } = await (context as RouteContext).params;
  if (!id) return fail(400, 'PROJECT_ID_REQUIRED', 'Project id is required');
  const { context: admin } = await scopedContentContext(request, 'project', id, 'content.edit', 'project.edit', true);
  const input = await parseBody(ProjectInputSchema, request, { maxBytes: 128 * 1024 });
  const result = await projectService(admin).updateStudio(id, input);
  invalidatePublicCache('projects');
  return ok(result);
});

export const DELETE = withHandler(async (_request, context) => {
  const { id } = await (context as RouteContext).params;
  if (!id) return fail(400, 'PROJECT_ID_REQUIRED', 'Project id is required');
  const { context: admin } = await scopedContentContext(_request, 'project', id, 'content.edit', 'project.edit', true);
  const expectedUpdatedAt = _request.headers.get('if-match');
  if (!expectedUpdatedAt) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required');
  const result = await projectService(admin).deleteStudio(id, expectedUpdatedAt);
  invalidatePublicCache('projects');
  return ok(result);
});

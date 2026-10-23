import {
  ProjectInputSchema,
  createProjectService,
  createSupabaseProjectStore,
  actorPermissionCheck,
  projectFiltersFromUrl,
  type ProjectDatabase,
} from '@/features/projects/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { invalidatePublicCache } from '@/features/marketing/public-cache';
import { typedContentContext } from '@/features/admin/content-review-production';
import { supabaseService } from '@/lib/supabase/server';

function projectService(context: Awaited<ReturnType<typeof typedContentContext>>['context']) {
  return createProjectService({
    store: createSupabaseProjectStore(supabaseService() as unknown as ProjectDatabase),
    authorize: actorPermissionCheck(context.actor, context.scope),
    scope: context.scope,
  });
}

export const GET = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.read', 'project.edit');
  return ok(await projectService(context).listStudio(projectFiltersFromUrl(request.url)));
});

export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'project.edit', true);
  const input = await parseBody(ProjectInputSchema, request, { maxBytes: 128 * 1024 });
  const result = await projectService(context).createStudio(input);
  await reviews.assignOwnership('project', result.id);
  invalidatePublicCache('projects');
  return ok(result, { status: 201 });
});

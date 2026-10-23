import {
  ProjectProposalSchema,
  listProjects,
  projectFiltersFromUrl,
  proposeProject,
} from '@/features/projects/service';
import { ok, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  return ok(await listProjects(user.id, projectFiltersFromUrl(request.url)));
});

export const POST = withHandler(async (request) => {
  const user = await requireApiUser();
  const input = await parseBody(ProjectProposalSchema, request, { maxBytes: 128 * 1024 });
  return ok(await proposeProject(user.id, input), { status: 201 });
});

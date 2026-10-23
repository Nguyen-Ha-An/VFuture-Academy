import { getProject } from '@/features/projects/service';
import { fail, ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { id } = await (context as RouteContext).params;
  if (!id) return fail(400, 'PROJECT_ID_REQUIRED', 'Project id is required');
  return ok(await getProject(user.id, id));
});

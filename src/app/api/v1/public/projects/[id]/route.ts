import { getPublicProject } from '@/features/marketing/public-discovery';
import { publicLocale } from '@/features/marketing/public-request';
import { publicRoute } from '@/features/marketing/public-route';
import { ApiError, withHandler } from '@/lib/api';

export const GET = withHandler(async (request, context) => publicRoute(async () => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const value = await getPublicProject(id, publicLocale(request.url));
  if (!value) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
  return value;
})(request));

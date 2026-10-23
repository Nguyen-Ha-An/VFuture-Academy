import { listPublicProjects } from '@/features/marketing/public-discovery';
import { publicLocale, publicPaging } from '@/features/marketing/public-request';
import { publicRoute } from '@/features/marketing/public-route';
import { withHandler } from '@/lib/api';

export const GET = withHandler(publicRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return listPublicProjects(publicLocale(request.url), {
    ...publicPaging(request.url),
    ...(params.get('skill') ? { skill: params.get('skill')!.slice(0, 64) } : {}),
    ...(params.get('course') ? { course: params.get('course')!.slice(0, 64) } : {}),
  });
}));

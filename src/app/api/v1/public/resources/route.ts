import { listPublicResources } from '@/features/marketing/public-discovery';
import { publicLocale, publicPaging } from '@/features/marketing/public-request';
import { publicRoute } from '@/features/marketing/public-route';
import { RESOURCE_TYPES } from '@/content-engine/schema/bundle';
import { withHandler } from '@/lib/api';
import { z } from 'zod';

export const GET = withHandler(publicRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return listPublicResources(publicLocale(request.url), {
    ...publicPaging(request.url),
    ...(params.get('type') ? { type: z.enum(RESOURCE_TYPES).parse(params.get('type')) } : {}),
    ...(params.get('tag') ? { tag: params.get('tag')!.slice(0, 40) } : {}),
    ...(params.get('pathway') ? { pathway: params.get('pathway')!.slice(0, 64) } : {}),
    ...(params.get('search') ? { search: params.get('search')!.slice(0, 200) } : {}),
  });
}));

import { listPublicOpportunities } from '@/features/marketing/public-discovery';
import { publicLocale, publicPaging } from '@/features/marketing/public-request';
import { publicRoute } from '@/features/marketing/public-route';
import { OPPORTUNITY_TYPES } from '@/features/opportunities/schema';
import { withHandler } from '@/lib/api';
import { z } from 'zod';

export const GET = withHandler(publicRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const boolean = (key: string) => params.has(key) ? z.enum(['true', 'false']).transform((value) => value === 'true').parse(params.get(key)) : undefined;
  const openNow = boolean('openNow');
  const featured = boolean('featured');
  return listPublicOpportunities(publicLocale(request.url), {
    ...publicPaging(request.url),
    ...(params.get('type') ? { type: z.enum(OPPORTUNITY_TYPES).parse(params.get('type')) } : {}),
    ...(openNow !== undefined ? { openNow } : {}), ...(featured !== undefined ? { featured } : {}),
  });
}));

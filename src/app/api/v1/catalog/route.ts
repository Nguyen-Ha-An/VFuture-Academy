import { z } from 'zod';

import { LocaleSchema, PATHWAYS } from '@/content-engine';
import { listCatalog } from '@/features/catalog/service';
import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const CatalogQuerySchema = z.object({
  locale: LocaleSchema.default('vi'),
  level: z.enum(['foundation', 'specialization']).optional(),
  pathway: z.enum(PATHWAYS).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  language: LocaleSchema.optional(),
}).strict();

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const url = new URL(request.url);
  const query = CatalogQuerySchema.parse({
    locale: url.searchParams.get('locale') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
    pathway: url.searchParams.get('pathway') ?? undefined,
    difficulty: url.searchParams.get('difficulty') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  });
  const { locale, ...filters } = query;
  return ok(await listCatalog({ userId: user.id, roles: [] }, locale, filters));
});

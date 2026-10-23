import { z } from 'zod';

import type { Locale } from '@/content-engine';

export function publicLocale(url: string): Locale {
  return z.enum(['vi', 'en']).parse(new URL(url).searchParams.get('locale') ?? 'vi');
}

export function publicPaging(url: string) {
  const params = new URL(url).searchParams;
  const page = z.coerce.number().int().min(1).max(10_000).optional().parse(params.get('page') ?? undefined);
  const pageSize = z.coerce.number().int().min(1).max(50).optional().parse(params.get('pageSize') ?? undefined);
  return { ...(page ? { page } : {}), ...(pageSize ? { pageSize } : {}) };
}

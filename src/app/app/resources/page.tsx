import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { learnerContext } from '@/features/ecosystem/context';
import { resourceListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { ResourceDiscoveryList } from '@/features/learner/ui/ResourceDiscovery';
import type { ExploreTranslate } from '@/features/learner/ui/explore-types';
import { createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';
import { lastPublicPage } from '@/features/marketing/PublicDiscoveryPrimitives';

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<LearnerListSearchParams> }) {
  const [user, locale, t, params] = await Promise.all([
    requireUser(), getLocale(), getTranslations('resources'), searchParams,
  ]);
  const context = await learnerContext(user.id, locale === 'en' ? 'en' : 'vi');
  const parsed = resourceListContext(params);
  const filters = parsed.filters;
  const service = createResourceService({ database: supabaseService() as unknown as ResourceDatabase, requirePermission: async () => { throw new Error('Read-only page'); } });
  const resources = await service.listPage(filters, context);
  const finalPage = lastPublicPage(resources.total, resources.pageSize);
  if (resources.page > finalPage) redirect(routes.learner.resources({ ...filters, page: finalPage }));
  return <ResourceDiscoveryList resources={resources} filters={filters} invalid={parsed.invalid} t={t as ExploreTranslate} />;
}

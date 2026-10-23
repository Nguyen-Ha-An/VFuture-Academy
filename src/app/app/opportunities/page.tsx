import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { learnerContext } from '@/features/ecosystem/context';
import { opportunityListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { OpportunityDiscoveryList } from '@/features/learner/ui/OpportunityDiscovery';
import type { ExploreTranslate } from '@/features/learner/ui/explore-types';
import { createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';
import { lastPublicPage } from '@/features/marketing/PublicDiscoveryPrimitives';

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<LearnerListSearchParams> }) {
  const [user, locale, t, params] = await Promise.all([requireUser(), getLocale(), getTranslations('opportunities'), searchParams]);
  const context = await learnerContext(user.id, locale === 'en' ? 'en' : 'vi');
  const parsed = opportunityListContext(params);
  const filters = parsed.filters;
  const service = createOpportunityService({ database: supabaseService() as unknown as OpportunityDatabase, requirePermission: async () => { throw new Error('Read-only page'); } });
  const now = new Date();
  const opportunities = await service.listPage(filters, { ...context, now });
  const finalPage = lastPublicPage(opportunities.total, opportunities.pageSize);
  if (opportunities.page > finalPage) redirect(routes.learner.opportunities({ ...filters, page: finalPage }));
  return <OpportunityDiscoveryList opportunities={opportunities} filters={filters} invalid={parsed.invalid} now={now} locale={locale} t={t as ExploreTranslate} />;
}

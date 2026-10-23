import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { listCatalog } from '@/features/catalog/service';
import { learnerContext } from '@/features/ecosystem/context';
import { opportunityListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { OpportunityDetail } from '@/features/learner/ui/OpportunityDetail';
import type { DetailTranslate } from '@/features/learner/ui/ResourceDetail';
import { createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export default async function OpportunityDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<LearnerListSearchParams> }) {
  const [{ id }, listParams, user, locale, t] = await Promise.all([params, searchParams ?? Promise.resolve({}), requireUser(), getLocale(), getTranslations('opportunities')]);
  const listContext = opportunityListContext(listParams).filters;
  const now = new Date();
  const context = { ...await learnerContext(user.id, locale === 'en' ? 'en' : 'vi'), now };
  const service = createOpportunityService({ database: supabaseService() as unknown as OpportunityDatabase, requirePermission: async () => { throw new Error('Read-only page'); } });
  let opportunity;
  try { opportunity = await service.get(id, context); } catch (error) { if (error instanceof ApiError && error.status === 404) notFound(); throw error; }
  const needsCatalog = opportunity.requiredCourses.length > 0 || opportunity.recommendedCourses.length > 0 || opportunity.recommendedSkills.length > 0;
  const catalog = needsCatalog ? await listCatalog({ userId: user.id, roles: [] }, context.locale).catch((error) => {
    console.error('[learner opportunities] course labels unavailable', error);
    return [];
  }) : [];
  return <OpportunityDetail opportunity={opportunity} listContext={listContext} catalog={catalog} locale={locale} now={now} t={t as DetailTranslate} />;
}

import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { learnerContext } from '@/features/ecosystem/context';
import { resourceListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { ResourceDetail, type DetailTranslate } from '@/features/learner/ui/ResourceDetail';
import { createResourceService, type ResourceDatabase } from '@/features/resources/service';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export default async function ResourceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<LearnerListSearchParams> }) {
  const [{ id }, listParams, user, locale, t] = await Promise.all([params, searchParams ?? Promise.resolve({}), requireUser(), getLocale(), getTranslations('resources')]);
  const listContext = resourceListContext(listParams).filters;
  const context = await learnerContext(user.id, locale === 'en' ? 'en' : 'vi');
  const service = createResourceService({ database: supabaseService() as unknown as ResourceDatabase, requirePermission: async () => { throw new Error('Read-only page'); } });
  let resource;
  try {
    resource = await service.get(id, context);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return <ResourceDetail resource={resource} listContext={listContext} t={t as DetailTranslate} />;
}

import { scopeKey } from '@/lib/admin-scope';
import { getLocale, getTranslations } from 'next-intl/server';

import { OpportunityFormSchema, type OpportunityForm } from '@/features/opportunities/schema';
import { actorOpportunityPermissionCheck, createOpportunityService, type OpportunityDatabase } from '@/features/opportunities/service';
import { OpportunityEditor } from '@/features/opportunities/ui/OpportunityEditor';
import { can } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { typedContentPageContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { EditorPageHeader } from '@/features/studio/ui/content/EditorPageHeader';

type PageProps = { params: Promise<{ id: string }> };

const newOpportunity: OpportunityForm = OpportunityFormSchema.parse({
  id: 'new-opportunity',
  title: { vi: 'Cơ hội mới', en: 'New opportunity' },
  organization: 'VFuture',
  type: 'event',
  description: {
    vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Mô tả cơ hội.' }] }] },
    en: { blocks: [{ type: 'paragraph', content: [{ text: 'Describe the opportunity.' }] }] },
  },
  eligibility: {},
  recommendedSkills: [],
  recommendedCourses: [],
  requiredCourses: [],
  applicationUrl: null,
  internalApplication: true,
  openAt: null,
  closeAt: null,
  startAt: null,
  endAt: null,
  location: null,
  online: false,
  branchScope: { scope: 'global' },
  featured: false,
});

function formFromRow(row: Record<string, unknown>): OpportunityForm {
  return OpportunityFormSchema.parse({
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    description: row.description,
    eligibility: row.eligibility ?? {},
    recommendedSkills: row.recommended_skills ?? [],
    recommendedCourses: row.recommended_courses ?? [],
    requiredCourses: row.required_courses ?? [],
    applicationUrl: row.application_url ?? null,
    internalApplication: row.internal_application === true,
    openAt: row.open_at ?? null,
    closeAt: row.close_at ?? null,
    startAt: row.start_at ?? null,
    endAt: row.end_at ?? null,
    location: row.location ?? null,
    online: row.online === true,
    branchScope: row.branch_scope ?? { scope: 'global' },
    featured: row.featured === true,
  });
}

export default async function StudioOpportunityDetailPage({ params }: PageProps) {
  const [{ id }, context, t, locale] = await Promise.all([params, typedContentPageContext('content.edit', 'opportunity.edit'), getTranslations('studio.opportunities'), getLocale()]);
  const actor = context.actor;
  let value = newOpportunity;
  let status = 'draft';
  let updatedAt: string | null = null;
  if (id !== 'new') {
    await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'opportunity', id, 'content.read');
    const service = createOpportunityService({ database: supabaseService() as unknown as OpportunityDatabase, requirePermission: actorOpportunityPermissionCheck(actor, context.scope), scope: context.scope });
    const row = await service.getStudio(id) as Record<string, unknown>;
    value = formFromRow(row);
    status = typeof row.status === 'string' ? row.status : 'draft';
    updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
  }
  const title = typeof value.title === 'string' ? value.title : value.title[locale === 'vi' ? 'vi' : 'en'] ?? value.title.vi ?? value.title.en ?? t('untitled');
  const statusLabel = status === 'published' || status === 'archived'
    ? t(`statuses.${status}`)
    : t('statuses.draft');
  const knownStatus = status === 'published' || status === 'archived' ? status : 'draft';
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6"><EditorPageHeader backHref="/studio/opportunities" backLabel={t('back')} title={title} status={{ kind: 'content', value: knownStatus, label: statusLabel }} /><OpportunityEditor key={id} recoveryKey={`studio:recovery:${context.actor.userId}:${scopeKey(context.scope)}:opportunity:${id}`} initialValue={value} canPublish={can(actor, 'opportunity.publish', context.scope)} initialStatus={status === 'published' || status === 'archived' ? status : 'draft'} initialUpdatedAt={updatedAt} isNew={id === 'new'} /></div>;
}

import { scopeKey } from '@/lib/admin-scope';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';

import type { Locale } from '@/content-engine/schema/common';
import { actorPermissionCheck, createProjectService, createSupabaseProjectStore, type ProjectDatabase } from '@/features/projects/service';
import { localizedPart } from '@/features/projects/ui/form-utils';
import { StudioProjectForm } from '@/features/projects/ui/StudioProjectForm';
import { ApiError } from '@/lib/api';
import { type AdminContext } from '@/features/admin/context';
import { typedContentPageContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { supabaseService } from '@/lib/supabase/server';
import { EditorPageHeader } from '@/features/studio/ui/content/EditorPageHeader';

async function editableProject(id: string, context: AdminContext) {
  try {
    await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, context.actor, 'project', id, 'content.read');
    const service = createProjectService({
      store: createSupabaseProjectStore(supabaseService() as unknown as ProjectDatabase),
      authorize: actorPermissionCheck(context.actor, context.scope),
      scope: context.scope,
    });
    return await service.getStudio(id);
  } catch (error) {
    if ((error instanceof ApiError && error.status === 404) || error instanceof z.ZodError) notFound();
    throw error;
  }
}

export default async function StudioProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, locale, t, context] = await Promise.all([
    params,
    getLocale() as Promise<Locale>,
    getTranslations('studio.projects'),
    typedContentPageContext('content.edit', 'project.edit'),
  ]);
  const project = await editableProject(id, context);
  const title = localizedPart(project.title, locale) || localizedPart(project.title, locale === 'vi' ? 'en' : 'vi');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <EditorPageHeader
        backHref="/studio/projects"
        backLabel={t('detail.back')}
        eyebrow={t('detail.eyebrow')}
        title={title}
        status={{ kind: 'project', value: project.status }}
        meta={project.interestList ? t('detail.interestCount', { count: project.interestList.length }) : null}
      />
      {project.interestList?.length ? <section aria-labelledby="studio-project-interest" className="rounded-lg border border-border bg-card p-6"><h2 id="studio-project-interest" className="text-sm font-medium leading-snug">{t('detail.interestedPeople')}</h2><ul className="mt-3 flex flex-wrap gap-2">{project.interestList.map((person) => <li key={person.userId} className="rounded-md border border-border px-2.5 py-1 text-sm leading-normal">{person.displayName ?? person.handle ?? person.userId}</li>)}</ul></section> : null}
      <StudioProjectForm key={id} recoveryKey={`studio:recovery:${context.actor.userId}:${scopeKey(context.scope)}:project:${id}`} mode="edit" initial={project} />
    </div>
  );
}

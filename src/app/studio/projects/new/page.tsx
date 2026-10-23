import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { typedContentPageContext } from '@/features/admin/content-review-production';
import { StudioProjectForm } from '@/features/projects/ui/StudioProjectForm';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { scopeKey } from '@/lib/admin-scope';

/** Create form for staff-led projects; the library's "Create project" link points here. */
export default async function StudioNewProjectPage() {
  const [context, t] = await Promise.all([
    typedContentPageContext('content.edit', 'project.edit'),
    getTranslations('studio.projects'),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link href="/studio/projects" className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t('detail.back')}
      </Link>
      <StaffPageHeader title={t('createTitle')} description={t('createDescription')} />
      <StudioProjectForm recoveryKey={`studio:recovery:${context.actor.userId}:${scopeKey(context.scope)}:project:new`} mode="create" />
    </div>
  );
}

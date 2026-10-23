import { getLocale } from 'next-intl/server';

import { typedContentPageContext } from '@/features/admin/content-review-production';
import { loadStudioProjects } from '@/features/studio/content-lists-data';
import { ContentListView } from '@/features/studio/ui/content/ContentListView';

export default async function StudioProjectsPage() {
  const [context, locale] = await Promise.all([
    typedContentPageContext('content.edit', 'project.edit'),
    getLocale(),
  ]);
  const rows = await loadStudioProjects(context, { locale: locale === 'en' ? 'en' : 'vi' });
  return <ContentListView kind="project" rows={rows} />;
}

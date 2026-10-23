import { getLocale } from 'next-intl/server';

import { typedContentPageContext } from '@/features/admin/content-review-production';
import { listPage, loadStudioResources } from '@/features/studio/content-lists-data';
import { ContentListView } from '@/features/studio/ui/content/ContentListView';

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default function StudioResourcesPage(): Promise<React.JSX.Element>;
export default function StudioResourcesPage(props: PageProps): Promise<React.JSX.Element>;
export default async function StudioResourcesPage({ searchParams = Promise.resolve({}) }: PageProps = {}) {
  const [context, locale, query] = await Promise.all([
    typedContentPageContext('content.edit', 'resource.edit'),
    getLocale(),
    searchParams,
  ]);
  const { rows, page, hasMore } = await loadStudioResources(context, { page: listPage(query.page), locale: locale === 'en' ? 'en' : 'vi' });
  return <ContentListView kind="resource" rows={rows} page={page} hasMore={hasMore} />;
}

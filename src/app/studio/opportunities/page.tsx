import { getLocale } from 'next-intl/server';

import { typedContentPageContext } from '@/features/admin/content-review-production';
import { listPage, loadStudioOpportunities } from '@/features/studio/content-lists-data';
import { ContentListView } from '@/features/studio/ui/content/ContentListView';

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default function StudioOpportunitiesPage(): Promise<React.JSX.Element>;
export default function StudioOpportunitiesPage(props: PageProps): Promise<React.JSX.Element>;
export default async function StudioOpportunitiesPage({ searchParams = Promise.resolve({}) }: PageProps = {}) {
  const [context, locale, query] = await Promise.all([
    typedContentPageContext('content.edit', 'opportunity.edit'),
    getLocale(),
    searchParams,
  ]);
  const { rows, page, hasMore } = await loadStudioOpportunities(context, { page: listPage(query.page), locale: locale === 'en' ? 'en' : 'vi' });
  return <ContentListView kind="opportunity" rows={rows} page={page} hasMore={hasMore} />;
}

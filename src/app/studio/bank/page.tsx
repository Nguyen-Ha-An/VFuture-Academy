import { bankFiltersFromUrl } from '@/features/bank/service';
import { typedContentPageContext } from '@/features/admin/content-review-production';
import { loadStudioBank } from '@/features/studio/content-lists-data';
import { BankListView } from '@/features/studio/ui/content/BankListView';

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function filterUrl(searchParams: Record<string, string | string[] | undefined>): string {
  const url = new URL('http://studio.local/studio/bank');
  for (const [key, rawValue] of Object.entries(searchParams)) {
    for (const value of Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue]) {
      url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

export default function StudioBankPage(): Promise<React.JSX.Element>;
export default function StudioBankPage(props: PageProps): Promise<React.JSX.Element>;
export default async function StudioBankPage({ searchParams = Promise.resolve({}) }: PageProps = {}) {
  const [context, rawSearchParams] = await Promise.all([
    typedContentPageContext('content.edit', 'bank.edit'),
    searchParams,
  ]);
  const filters = bankFiltersFromUrl(filterUrl(rawSearchParams));
  const questions = await loadStudioBank(context, filters);
  return <BankListView questions={questions} filters={filters} />;
}

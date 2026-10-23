import { redirect } from 'next/navigation';
import { publicHref } from '@/features/public-site/public-navigation';

/** Historical Academy entry preserves public query context. */
export default async function AcademyEntry({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  redirect(publicHref('/', query.lang === 'en' ? 'en' : 'vi', query));
}

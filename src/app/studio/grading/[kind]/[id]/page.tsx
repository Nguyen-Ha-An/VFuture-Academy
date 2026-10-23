import { notFound, redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

/** Old grading detail bookmarks resolve to the Assessment & grading workbench. */
export default async function LegacyPage({ params, searchParams }: {
  params: Promise<{ kind: string; id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ kind, id }, query] = await Promise.all([params, searchParams ?? Promise.resolve(undefined)]);
  if (kind === 'assignments') redirect(routes.grading.assignment(id, query));
  if (kind === 'exams') redirect(routes.grading.exam(id, query));
  notFound();
}

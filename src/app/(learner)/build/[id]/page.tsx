import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RouteQuery>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  redirect(routes.learner.project(id, query));
}

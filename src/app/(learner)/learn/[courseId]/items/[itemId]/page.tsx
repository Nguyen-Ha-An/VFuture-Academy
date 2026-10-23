import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyCourseItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
  searchParams: Promise<RouteQuery>;
}) {
  const [{ courseId, itemId }, query] = await Promise.all([params, searchParams]);
  redirect(routes.learner.courseItem(courseId, itemId, query));
}

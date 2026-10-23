import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<RouteQuery>;
}) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  redirect(routes.learner.course(courseId, query));
}

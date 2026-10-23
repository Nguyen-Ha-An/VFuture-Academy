import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyCoursesPage({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  redirect(routes.learner.courses(await searchParams));
}

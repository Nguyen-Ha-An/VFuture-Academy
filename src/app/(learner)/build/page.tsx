import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyProjectsPage({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  redirect(routes.learner.projects(await searchParams));
}

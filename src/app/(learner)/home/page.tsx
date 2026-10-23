import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyHomePage({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  redirect(routes.learner.dashboard(await searchParams));
}

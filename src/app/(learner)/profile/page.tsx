import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyProfilePage({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  redirect(routes.learner.profile(await searchParams));
}

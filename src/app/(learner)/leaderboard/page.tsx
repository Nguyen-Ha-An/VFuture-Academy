import { redirect } from 'next/navigation';

import { routes, type RouteQuery } from '@/lib/routes';

export default async function LegacyLeaderboardPage({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  redirect(routes.learner.leaderboard(await searchParams));
}

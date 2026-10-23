import { branchIdForUser } from '@/features/me/service';
import { getProfileSettings } from '@/features/profile/service';
import { weeklyLeaderboard } from '@/features/xp/service';
import { LeaderboardBoardView, type LeaderboardScopeValue } from './LeaderboardBench';
import type { LeaderboardViewer } from './leaderboard-rows';

async function viewerOf(userId: string): Promise<LeaderboardViewer> {
  try {
    const settings = await getProfileSettings(userId);
    return { handle: settings.handle, profilePublic: settings.profilePublic };
  } catch {
    return { handle: null, profilePublic: false };
  }
}

/** Secondary block: loads the weekly board inside its own Suspense and SectionBoundary slot. */
export async function LeaderboardBoard({ scope, userId }: { scope: LeaderboardScopeValue; userId: string }) {
  const branchId = scope === 'branch' ? await branchIdForUser(userId) : undefined;
  if (scope === 'branch' && !branchId) return <LeaderboardBoardView entries={[]} viewer={{ handle: null, profilePublic: false }} noBranch />;
  const [entries, viewer, previous] = await Promise.all([
    weeklyLeaderboard(scope, branchId ?? undefined),
    viewerOf(userId),
    // Last week's board powers the rank-change column; if it fails, the column is omitted.
    weeklyLeaderboard(scope, branchId ?? undefined, { weeksAgo: 1 }).catch(() => null),
  ]);
  const previousRanks = previous ? Object.fromEntries(previous.flatMap(entry => entry.handle ? [[entry.handle, entry.rank]] : [])) : undefined;
  return <LeaderboardBoardView entries={entries} viewer={viewer} previousRanks={previousRanks} />;
}

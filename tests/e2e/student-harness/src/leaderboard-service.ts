export async function branchIdForUser(_userId: string) { return 'fixture-branch'; }
export async function weeklyLeaderboard(scope: 'global' | 'branch', branchId?: string) {
 if (scope === 'branch' && branchId !== 'fixture-branch') throw new Error('Unconfigured leaderboard branch');
 return [
  { rank: 1, displayName: 'Fixture Student', handle: 'fixture-student', points: 220 },
  { rank: 2, displayName: 'A learner with a deliberately long display name for responsive table geometry', handle: null, points: 180 },
  { rank: 3, displayName: null, handle: 'learning-peer', points: 120 },
 ];
}

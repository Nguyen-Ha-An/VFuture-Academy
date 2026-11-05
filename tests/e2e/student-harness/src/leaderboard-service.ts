import { supportReviewParam } from '../../support/support-review-state';

const supportState = () => supportReviewParam('supportState');
export async function branchIdForUser(_userId: string) {
 if (supportState() === 'error') throw new Error('Synthetic support fixture: branch unavailable');
 return supportState() === 'no-branch' ? null : 'fixture-branch';
}
export async function weeklyLeaderboard(scope: 'global' | 'branch', branchId?: string, options?: { weeksAgo?: number }) {
 if (supportState() === 'error') throw new Error('Synthetic support fixture: leaderboard unavailable');
 if (scope === 'branch' && branchId !== 'fixture-branch') throw new Error('Unconfigured leaderboard branch');
 if (supportState() === 'empty') return [];
 if (supportState() === 'dense') return Array.from({ length: 28 }, (_, index) => ({
  rank: options?.weeksAgo === 1 && index >= 22 && index <= 25 ? index === 22 ? 26 : index : index + 1,
  displayName: index === 22 ? 'Fixture Student' : `Synthetic learning peer ${index + 1}`,
  handle: index === 22 ? 'fixture-student' : `fixture-peer-${index + 1}`,
  points: 980 - index * 23,
 }));
 const entries = [
  { rank: 1, displayName: 'Fixture Student', handle: 'fixture-student', points: 220 },
  { rank: 2, displayName: 'A learner with a deliberately long display name for responsive table geometry', handle: null, points: 180 },
  { rank: 3, displayName: null, handle: 'learning-peer', points: 120 },
 ];
 return ['private', 'unranked'].includes(supportState() ?? '') ? entries.filter(entry => entry.handle !== 'fixture-student') : entries;
}

import { activityTrace, type ActivityLabels } from '../../../../src/features/workspace-ui/learner/activity.server';

/** Deterministic 14-day xp_events fixture for the bench Trace Rail and XP readout. */
export async function learnerActivitySeries(_userId: string, labels?: ActivityLabels) {
  const now = new Date();
  const day = (ago: number, hour = 10) => new Date(now.getTime() - ago * 86_400_000 - hour * 60_000).toISOString();
  const rows = [
    ...[13, 12, 10, 9, 8, 6, 5, 3, 2, 1, 0].map((ago, index) => ({ kind: 'lesson_completed', points: 20 + ((index * 17) % 45), createdAt: day(ago) })),
    { kind: 'assignment_approved', points: 120, createdAt: day(10, 30) },
    { kind: 'exam_passed', points: 140, createdAt: day(3, 40) },
  ];
  return activityTrace(rows, now, labels);
}

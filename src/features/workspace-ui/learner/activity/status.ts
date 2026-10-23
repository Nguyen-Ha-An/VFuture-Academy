import type { Tone } from '../../ui/primitives';

/** Item statuses the outline, head and footer can show (progress and submission states). */
export type ActivityStatus = 'not_started' | 'in_progress' | 'completed' | 'submitted' | 'in_review' | 'approved' | 'changes_requested';

/** Message keys under `bench.learner.activity.state`. */
export type ActivityStateKey = 'notStarted' | 'inProgress' | 'completed' | 'submitted' | 'inReview' | 'approved' | 'changesRequested';

const STATUS: Record<ActivityStatus, { key: ActivityStateKey; tone: Tone }> = {
  not_started: { key: 'notStarted', tone: 'neutral' },
  in_progress: { key: 'inProgress', tone: 'pending' },
  completed: { key: 'completed', tone: 'signal' },
  submitted: { key: 'submitted', tone: 'pending' },
  in_review: { key: 'inReview', tone: 'pending' },
  approved: { key: 'approved', tone: 'signal' },
  changes_requested: { key: 'changesRequested', tone: 'fault' },
};

export function activityStatus(value: unknown): ActivityStatus {
  return typeof value === 'string' && value in STATUS ? value as ActivityStatus : 'not_started';
}

/** The state tag for a status: completed/approved signal, waiting pending, changes requested fault. */
export function activityStatusTag(value: unknown): { key: ActivityStateKey; tone: Tone } {
  return STATUS[activityStatus(value)];
}

/** Two-digit mono readout, e.g. 02 / 12. */
export const pad2 = (value: number) => String(value).padStart(2, '0');

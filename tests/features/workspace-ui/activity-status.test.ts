import { describe, expect, it } from 'vitest';
import { activityStatus, activityStatusTag } from '@/features/workspace-ui/learner/activity/status';
import messages from '@/messages/bench/learner.json';

describe('public activity lifecycle tags', () => {
  it('preserves the expired lifecycle instead of calling it not started or complete', () => {
    expect(activityStatus('expired')).toBe('expired');
    expect(activityStatusTag('expired')).toEqual({ key: 'expired', tone: 'fault' });
    expect(messages.en.activity.state).toHaveProperty('expired', 'Expired');
    expect(messages.vi.activity.state).toHaveProperty('expired', 'Đã hết hạn');
  });
  it('retains existing submitted, review and completion tags and fails closed for unknown statuses', () => {
    expect(activityStatusTag('submitted')).toEqual({ key: 'submitted', tone: 'pending' });
    expect(activityStatusTag('in_review')).toEqual({ key: 'inReview', tone: 'pending' });
    expect(activityStatusTag('completed')).toEqual({ key: 'completed', tone: 'signal' });
    expect(activityStatus('unknown-private-status')).toBe('not_started');
  });
});

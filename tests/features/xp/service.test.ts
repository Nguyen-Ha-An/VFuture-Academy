import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import {
  activityDateInVietnam,
  createXpService,
  nextStreak,
  XP_POINTS,
} from '@/features/xp/service';
import { SupabaseStub, successful } from '../learner/test-kit';

describe('XP awards', () => {
  it('uses the unique event as the idempotency receipt while keeping streak repair retryable', async () => {
    const duplicate = { code: '23505', message: 'duplicate key' };
    const database = new SupabaseStub({
      xp_events: [
        successful({ id: 'event-1', points: 10, created_at: '2026-09-03T12:00:00.000Z' }),
        { data: null, error: duplicate },
        successful({ id: 'event-1', points: 10, created_at: '2026-09-03T12:00:00.000Z' }),
      ],
    }, {
      xp_update_streak: [
        successful([{ current_streak: 1, longest_streak: 1, last_active_date: '2026-09-03' }]),
        successful([{ current_streak: 1, longest_streak: 1, last_active_date: '2026-09-03' }]),
      ],
    });
    const service = createXpService({
      database,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    await expect(service.award('learner-1', 'lesson_completed', 'lesson', 'version-1:lesson-1'))
      .resolves.toMatchObject({ awarded: true, points: 10, streak: { current: 1, longest: 1 } });
    await expect(service.award('learner-1', 'lesson_completed', 'lesson', 'version-1:lesson-1'))
      .resolves.toMatchObject({ awarded: false, points: 10, streak: { current: 1, longest: 1 } });

    const insertedEvents = database.queriesFor('xp_events').flatMap((query) => query.operations)
      .filter(([operation]) => operation === 'insert');
    expect(insertedEvents).toHaveLength(2);
    expect(insertedEvents[0]).toEqual(['insert', expect.objectContaining({
      user_id: 'learner-1',
      kind: 'lesson_completed',
      points: 10,
      ref_type: 'lesson',
      ref_id: 'version-1:lesson-1',
    })]);
    expect(database.queriesFor('streaks')).toHaveLength(0);
    expect(database.rpcCalls.filter(({ name }) => name === 'xp_update_streak')).toEqual([
      { name: 'xp_update_streak', args: { user_id: 'learner-1', active_date: '2026-09-03' } },
      { name: 'xp_update_streak', args: { user_id: 'learner-1', active_date: '2026-09-03' } },
    ]);
  });

  it.each([
    ['lesson_completed', 10],
    ['quiz_submitted', 20],
    ['exam_passed', 50],
    ['assignment_approved', 30],
    ['course_completed', 100],
  ] as const)('caps caller-supplied points for %s at %i', async (kind, expectedPoints) => {
    const database = new SupabaseStub({
      xp_events: [successful({ id: `event-${kind}`, points: expectedPoints, created_at: '2026-09-03T12:00:00.000Z' })],
    }, {
      xp_update_streak: [successful([{ current_streak: 1, longest_streak: 1, last_active_date: '2026-09-03' }])],
    });
    const service = createXpService({ database, now: () => new Date('2026-09-03T12:00:00.000Z') });

    await service.award('learner-1', kind, 'test', `ref-${kind}`, 999_999);

    expect(database.queriesFor('xp_events')[0].operations).toContainEqual([
      'insert', expect.objectContaining({ points: expectedPoints }),
    ]);
    expect(expectedPoints).toBe(kind === 'quiz_submitted' ? 20 : XP_POINTS[kind]);
  });

  it('rolls the activity date at midnight in Asia/Ho_Chi_Minh', () => {
    expect(activityDateInVietnam(new Date('2026-09-03T16:59:59.000Z'))).toBe('2026-09-03');
    expect(activityDateInVietnam(new Date('2026-09-03T17:00:00.000Z'))).toBe('2026-09-04');
  });

  it('increments on the next local day and resets after a skipped local day', () => {
    expect(nextStreak({ current: 4, longest: 7, lastActiveDate: '2026-09-03' }, '2026-09-04'))
      .toEqual({ current: 5, longest: 7, lastActiveDate: '2026-09-04' });
    expect(nextStreak({ current: 5, longest: 7, lastActiveDate: '2026-09-04' }, '2026-09-06'))
      .toEqual({ current: 1, longest: 7, lastActiveDate: '2026-09-06' });
  });

  it('reads an earlier ICT week when asked for last week', async () => {
    const database = new SupabaseStub({}, { xp_weekly_leaderboard: [successful([])] });
    const service = createXpService({ database, now: () => new Date('2026-09-03T05:00:00.000Z') });
    await service.weeklyLeaderboard('global', undefined, { weeksAgo: 1 });
    expect(database.rpcCalls).toContainEqual({
      name: 'xp_weekly_leaderboard',
      args: { scope: 'global', branch_id: null, week_start: '2026-08-23T17:00:00.000Z' },
    });
  });

  it('excludes profiles that did not opt into the weekly leaderboard', async () => {
    const database = new SupabaseStub({}, {
      xp_weekly_leaderboard: [successful([
        { rank: 1, handle: 'public-one', display_name: 'Public One', points: 40 },
      ])],
    });
    const service = createXpService({
      database,
      now: () => new Date('2026-09-03T05:00:00.000Z'),
    });

    await expect(service.weeklyLeaderboard('global')).resolves.toEqual([
      { rank: 1, handle: 'public-one', displayName: 'Public One', points: 40 },
    ]);
    expect(database.queriesFor('xp_events')).toHaveLength(0);
    expect(database.queriesFor('profiles')).toHaveLength(0);
    expect(database.rpcCalls).toContainEqual({
      name: 'xp_weekly_leaderboard',
      args: {
        scope: 'global',
        branch_id: null,
        week_start: '2026-08-30T17:00:00.000Z',
      },
    });
  });

  it('loads user totals from the aggregation RPC instead of selecting XP rows', async () => {
    const database = new SupabaseStub({
      streaks: [successful({ current_streak: 3, longest_streak: 5, last_active_date: '2026-09-03' })],
    }, {
      xp_user_total: [successful([{ total_points: 160, weekly_points: 40 }])],
    });
    const service = createXpService({ database, now: () => new Date('2026-09-03T05:00:00.000Z') });

    await expect(service.summary('learner-1')).resolves.toEqual({
      total: 160,
      weekly: 40,
      streak: { current: 3, longest: 5, lastActiveDate: '2026-09-03' },
    });
    expect(database.queriesFor('xp_events')).toHaveLength(0);
    expect(database.rpcCalls).toContainEqual({
      name: 'xp_user_total',
      args: { user_id: 'learner-1' },
    });
  });
});

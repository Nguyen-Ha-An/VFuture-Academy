import 'server-only';

import { ApiError } from '@/lib/api';

export const XP_POINTS = {
  lesson_completed: 10,
  quiz_submitted: 5,
  exam_passed: 50,
  assignment_approved: 30,
  course_completed: 100,
} as const;

const XP_POINT_CAPS: Record<keyof typeof XP_POINTS, number> = {
  ...XP_POINTS,
  quiz_submitted: 20,
};

export type XpKind = keyof typeof XP_POINTS;
export type LeaderboardScope = 'global' | 'branch';

type QueryResult = { data: unknown; error: unknown | null };

export interface XpQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  insert(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  gte(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

export interface XpDatabase {
  from(table: string): XpQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
}

type StreakState = {
  current: number;
  longest: number;
  lastActiveDate: string | null;
};

type Dependencies = {
  database: XpDatabase;
  now?: () => Date;
};

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const row = record(entry);
      return row ? [row] : [];
    })
    : [];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
}

function databaseFailure(message: string): never {
  throw new ApiError(500, 'XP_DATABASE_ERROR', message);
}

function errorCode(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof (value as { code?: unknown }).code === 'string'
    ? (value as { code: string }).code
    : null;
}

function dateOrdinal(value: string): number {
  if (!DATE_PATTERN.test(value)) return Number.NaN;
  const ordinal = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ordinal) ? ordinal : Number.NaN;
}

function dateFromOrdinal(ordinal: number): string {
  return new Date(ordinal).toISOString().slice(0, 10);
}

/** Returns the calendar date that contains the instant in Vietnam. */
export function activityDateInVietnam(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new Error('Activity time is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Applies one activity day without double-incrementing or rolling a streak backwards. */
export function nextStreak(previous: StreakState | null, activeDate: string): StreakState {
  const activeOrdinal = dateOrdinal(activeDate);
  if (!Number.isFinite(activeOrdinal)) throw new Error('Activity date is invalid');
  if (!previous?.lastActiveDate) return { current: 1, longest: Math.max(previous?.longest ?? 0, 1), lastActiveDate: activeDate };
  const lastOrdinal = dateOrdinal(previous.lastActiveDate);
  if (!Number.isFinite(lastOrdinal)) return { current: 1, longest: Math.max(previous.longest, 1), lastActiveDate: activeDate };
  if (activeOrdinal <= lastOrdinal) return previous;
  const current = activeOrdinal - lastOrdinal === 86_400_000 ? previous.current + 1 : 1;
  return { current, longest: Math.max(previous.longest, current), lastActiveDate: activeDate };
}

function parsedStreak(value: unknown): StreakState | null {
  const row = record(value);
  if (!row) return null;
  const current = Number(row.current_streak);
  const longest = Number(row.longest_streak);
  const lastActiveDate = typeof row.last_active_date === 'string' ? row.last_active_date : null;
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(longest) || longest < 0) return null;
  return { current, longest, lastActiveDate };
}

function pointsFor(kind: XpKind, requested?: number): number {
  if (kind !== 'quiz_submitted') return XP_POINTS[kind];
  const points = requested ?? XP_POINTS.quiz_submitted;
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new ApiError(400, 'INVALID_XP_POINTS', 'XP points must be a non-negative integer');
  }
  return Math.min(points, XP_POINT_CAPS.quiz_submitted);
}

function parsedEvent(value: unknown) {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.created_at !== 'string') return null;
  const points = Number(row.points);
  if (!Number.isFinite(points)) return null;
  return { id: row.id, points, createdAt: row.created_at };
}

function weekBounds(now: Date) {
  const localDate = activityDateInVietnam(now);
  const localOrdinal = dateOrdinal(localDate);
  const day = new Date(localOrdinal).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = dateFromOrdinal(localOrdinal - daysSinceMonday * 86_400_000);
  const followingMonday = dateFromOrdinal(localOrdinal + (7 - daysSinceMonday) * 86_400_000);
  return {
    start: new Date(`${monday}T00:00:00+07:00`),
    end: new Date(`${followingMonday}T00:00:00+07:00`),
  };
}

async function updateStreak(database: XpDatabase, userId: string, activeDate: string) {
  const savedResult = await database.rpc('xp_update_streak', {
    user_id: userId,
    active_date: activeDate,
  });
  if (savedResult.error) databaseFailure('Streak could not be updated');
  const streak = parsedStreak(firstRecord(savedResult.data));
  if (!streak) databaseFailure('Streak could not be updated');
  return streak;
}

export function createXpService({ database, now = () => new Date() }: Dependencies) {
  async function award(
    userId: string,
    kind: XpKind,
    refType: string,
    refId: string,
    points?: number,
  ) {
    const awardedPoints = pointsFor(kind, points);
    const createdAt = now();
    const insertResult = await database.from('xp_events')
      .insert({
        user_id: userId,
        kind,
        points: awardedPoints,
        ref_type: refType,
        ref_id: refId,
        created_at: createdAt.toISOString(),
      })
      .select('id,points,created_at')
      .single();

    let duplicate = false;
    let event = parsedEvent(insertResult.data);
    if (errorCode(insertResult.error) === '23505') {
      duplicate = true;
      const existingResult = await database.from('xp_events')
        .select('id,points,created_at')
        .eq('user_id', userId)
        .eq('kind', kind)
        .eq('ref_type', refType)
        .eq('ref_id', refId)
        .maybeSingle();
      if (existingResult.error) databaseFailure('Existing XP event could not be loaded');
      event = parsedEvent(existingResult.data);
    } else if (insertResult.error) {
      databaseFailure('XP event could not be saved');
    }
    if (!event) databaseFailure('XP event could not be saved');

    // A duplicate still repairs a streak update that may have failed after the
    // original event committed. nextStreak makes that repair idempotent.
    const streak = await updateStreak(database, userId, activityDateInVietnam(new Date(event.createdAt)));
    return {
      awarded: !duplicate,
      eventId: event.id,
      points: event.points,
      streak: { current: streak.current, longest: streak.longest, lastActiveDate: streak.lastActiveDate },
    };
  }

  /** `weeksAgo` reads an earlier ICT week (1 = last week) for rank-change comparisons. */
  async function weeklyLeaderboard(scope: LeaderboardScope, branchId?: string, { weeksAgo = 0 }: { weeksAgo?: number } = {}) {
    if (scope === 'branch' && !branchId) throw new ApiError(400, 'BRANCH_REQUIRED', 'A branch leaderboard requires a branch');
    const bounds = weekBounds(now());
    const start = new Date(bounds.start.getTime() - Math.max(0, Math.trunc(weeksAgo)) * 7 * 86_400_000);
    const leaderboardResult = await database.rpc('xp_weekly_leaderboard', {
      scope,
      branch_id: branchId ?? null,
      week_start: start.toISOString(),
    });
    if (leaderboardResult.error) databaseFailure('Weekly XP could not be loaded');
    return records(leaderboardResult.data)
      .flatMap((entry) => {
        const rank = Number(entry.rank);
        const points = Number(entry.points);
        if (!Number.isSafeInteger(rank) || rank < 1 || !Number.isFinite(points)) return [];
        return [{
          rank,
          handle: typeof entry.handle === 'string' ? entry.handle : null,
          displayName: typeof entry.display_name === 'string' ? entry.display_name : '',
          points,
        }];
      })
      .sort((left, right) => left.rank - right.rank);
  }

  async function summary(userId: string) {
    const [totalsResult, streakResult] = await Promise.all([
      database.rpc('xp_user_total', { user_id: userId }),
      database.from('streaks').select('current_streak,longest_streak,last_active_date').eq('user_id', userId).maybeSingle(),
    ]);
    if (totalsResult.error || streakResult.error) databaseFailure('XP summary could not be loaded');
    const totals = firstRecord(totalsResult.data);
    const total = Number(totals?.total_points ?? 0);
    const weekly = Number(totals?.weekly_points ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(weekly)) databaseFailure('XP summary could not be loaded');
    const streak = parsedStreak(streakResult.data) ?? { current: 0, longest: 0, lastActiveDate: null };
    return { total, weekly, streak: { current: streak.current, longest: streak.longest, lastActiveDate: streak.lastActiveDate } };
  }

  return { award, weeklyLeaderboard, summary };
}

async function productionService() {
  const { supabaseService } = await import('@/lib/supabase/server');
  return createXpService({ database: supabaseService() as unknown as XpDatabase });
}

export async function award(userId: string, kind: XpKind, refType: string, refId: string, points?: number) {
  return (await productionService()).award(userId, kind, refType, refId, points);
}

export async function weeklyLeaderboard(scope: LeaderboardScope, branchId?: string, options?: { weeksAgo?: number }) {
  return (await productionService()).weeklyLeaderboard(scope, branchId, options);
}

export async function xpSummary(userId: string) {
  return (await productionService()).summary(userId);
}

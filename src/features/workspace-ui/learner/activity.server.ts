import 'server-only';

import type { XpDatabase } from '@/features/xp/service';
import { lastVietnamDays, vietnamDay } from '../format';
import type { TraceDay, TraceEvent } from '../ui/TraceRail';

/** XP kinds worth a marker on the rail: milestones, not every lesson tick. */
const MILESTONE_KINDS = new Set(['exam_passed', 'assignment_approved', 'course_completed']);

export type ActivityRow = { kind: string; points: number; createdAt: string };

export type ActivityLabels = {
  /** Day readout, e.g. `+140 XP`. */
  points: (points: number) => string;
  /** Marker label for a milestone kind, e.g. `Exam passed`. */
  kind: (kind: string) => string;
};

export type LearnerActivitySeries = {
  /** Oldest first, one entry per Vietnam calendar day. */
  days: TraceDay[];
  events: TraceEvent[];
  /** XP per day, aligned with `days`. */
  values: number[];
  /** XP earned since Monday (ICT) and over the same number of days one week earlier. */
  week: { current: number; previous: number };
};

const defaultLabels: ActivityLabels = {
  points: points => `+${points} XP`,
  kind: kind => kind.replace(/_/g, ' '),
};

function rowsOf(value: unknown): ActivityRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const points = Number(row.points);
    if (typeof row.kind !== 'string' || typeof row.created_at !== 'string' || !Number.isFinite(points)) return [];
    return [{ kind: row.kind, points, createdAt: row.created_at }];
  });
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Pure grouping of xp_events rows into the 14-day Trace Rail series (ICT days, oldest first). */
export function activityTrace(rows: ActivityRow[], now: Date = new Date(), labels: ActivityLabels = defaultLabels, length = 14): LearnerActivitySeries {
  const keys = lastVietnamDays(length, now);
  const index = new Map(keys.map((key, position) => [key, position]));
  const values = keys.map(() => 0);
  const milestones = new Map<number, { kind: string; points: number }[]>();
  for (const row of rows) {
    const at = new Date(row.createdAt);
    if (!Number.isFinite(at.getTime())) continue;
    const position = index.get(vietnamDay(at));
    if (position === undefined) continue;
    values[position] += row.points;
    if (MILESTONE_KINDS.has(row.kind)) milestones.set(position, [...(milestones.get(position) ?? []), { kind: row.kind, points: row.points }]);
  }
  const days = keys.map((date, position): TraceDay => ({ date, value: round(values[position]), readout: labels.points(round(values[position])) }));
  const events = [...milestones.entries()].sort(([a], [b]) => a - b).map(([dayIndex, entries]): TraceEvent => ({
    dayIndex,
    tone: 'signal',
    label: `${entries.map(entry => labels.kind(entry.kind)).join(', ')} · ${labels.points(round(values[dayIndex]))}`,
  }));
  // Week-to-date against the same span one week earlier; both fit inside the 14-day window.
  const today = keys[keys.length - 1];
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const last = values.length - 1;
  const sum = (from: number, to: number) => values.slice(Math.max(0, from), Math.max(0, to + 1)).reduce((total, value) => total + value, 0);
  return {
    days,
    events,
    values: values.map(round),
    week: { current: round(sum(last - sinceMonday, last)), previous: round(sum(last - sinceMonday - 7, last - 7)) },
  };
}

export function createLearnerActivity({ database, now = () => new Date() }: { database: XpDatabase; now?: () => Date }) {
  return {
    async series(userId: string, labels?: ActivityLabels): Promise<LearnerActivitySeries> {
      const at = now();
      const [first] = lastVietnamDays(14, at);
      const result = await database.from('xp_events')
        .select('kind,points,created_at')
        .eq('user_id', userId)
        .gte('created_at', new Date(`${first}T00:00:00+07:00`).toISOString());
      if (result.error) throw new Error('Learner activity could not be loaded');
      return activityTrace(rowsOf(result.data), at, labels);
    },
  };
}

/** The learner's last 14 Vietnam days of XP, grouped for the Trace Rail and the XP readout. */
export async function learnerActivitySeries(userId: string, labels?: ActivityLabels): Promise<LearnerActivitySeries> {
  const { supabaseService } = await import('@/lib/supabase/server');
  return createLearnerActivity({ database: supabaseService() as unknown as XpDatabase }).series(userId, labels);
}

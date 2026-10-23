import 'server-only';

import type { Locale } from '@/content-engine/schema/common';
import { actorDisplayNames, type ActorDisplay } from '@/features/admin/actor-directory';
import type { SubmissionStatus } from '@/features/instructor-grading/types';
import type { SubmissionQueueFilter, SubmissionQueuePage, SubmissionQueueSubmission } from '@/features/submissions/contracts';
import { queue as readQueue } from '@/features/submissions/service';
import type { Actor } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';
import { resolveCourseTitle, resolveItemTitle, versionTitles, type VersionTitles } from './titles';

/**
 * Everything the grading home shows, read in one place so the page stays a thin loader and the
 * tests mock one module. Every section settles on its own: a failed read becomes `null`, which
 * the view renders as "Unavailable" (never 0), while the other sections still show.
 */

export const OVERVIEW_STATUSES = ['submitted', 'in_review', 'approved', 'changes_requested'] as const satisfies readonly SubmissionStatus[];
export const OLDEST_WAITING_LIMIT = 5;
export const RECENT_GRADES_LIMIT = 6;
export const THROUGHPUT_DAYS = 30;
/** Throughput rows are read 1,000 at a time; beyond this many the series is reported unavailable. */
export const THROUGHPUT_ROW_CAP = 20_000;
/** Extra queue pages the home reads when the first page holds no waiting submission. */
export const OLDEST_EXTRA_PAGES = 3;

const DAY_MS = 86_400_000;
const ROW_PAGE = 1_000;

/** Which submissions the reader grades: the same branch rule the queue applies. */
export type GradingOverviewScope = { global: boolean; branchIds: string[] };

/** Names and titles are null when they cannot be resolved; the view shows a placeholder, never a raw id. */
export type OverviewSubmission = {
  id: string;
  learnerName: string | null;
  courseTitle: string | null;
  itemTitle: string | null;
  status: SubmissionStatus;
  submittedAt: string;
  href: string;
};

export type RecentGrade = {
  id: string;
  /** Null when the grader's profile has no usable name (the view says "A grader"). */
  graderName: string | null;
  graderAvatarUrl: string | null;
  learnerName: string | null;
  itemTitle: string | null;
  released: boolean;
  decision: 'approved' | 'changes_requested';
  gradedAt: string;
  href: string;
};

/** One UTC day: submissions received and grades returned to learners. */
export type ThroughputDay = { day: string; received: number; released: number };

export type GradingOverview = {
  /** ISO time the numbers were read; relative ages are measured from it. */
  generatedAt: string;
  /** Stored submission status counts (snapshot, no deltas). */
  statusCounts: Record<SubmissionStatus, number> | null;
  /** Submitted plus in review: the same definition as the admin "pending grading" count. */
  waiting: number | null;
  /** Exam attempts that stopped at `pending_manual`. */
  examsAwaitingManual: number | null;
  /** Released grades saved in the last 7 days and in the 7 days before; the only delta on the page. */
  gradedLast7Days: number | null;
  gradedPrior7Days: number | null;
  /** The next submissions to grade, oldest first, exactly as the queue's "Waiting" filter orders them. */
  oldest: OverviewSubmission[] | null;
  throughput: ThroughputDay[] | null;
  recent: RecentGrade[] | null;
};

type QueryResult = { data: unknown; error: unknown; count?: number | null };

export interface OverviewQuery extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(count: number): this;
  range(from: number, to: number): this;
}

export interface OverviewDatabase {
  from(table: string): OverviewQuery;
}

export type GradingOverviewDependencies = {
  database?: OverviewDatabase;
  queue?: (actor: Actor, filter: SubmissionQueueFilter) => Promise<SubmissionQueuePage>;
  titles?: typeof versionTitles;
  actors?: (ids: Iterable<string | null | undefined>) => Promise<Map<string, ActorDisplay>>;
  now?: () => Date;
};

export type GradingOverviewInput = {
  actor: Actor;
  scope: GradingOverviewScope;
  locale: Locale;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function first(value: unknown): Record<string, unknown> | null {
  return record(Array.isArray(value) ? value[0] : value);
}

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** YYYY-MM-DD of the UTC day containing `date`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last `days` UTC days ending today, oldest first. */
export function throughputDays(now: Date, days = THROUGHPUT_DAYS): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => utcDay(new Date(today - (days - 1 - index) * DAY_MS)));
}

/** Buckets ISO timestamps into the given UTC days, zero-filling the rest; stamps outside are ignored. */
export function bucketByDay(days: readonly string[], received: readonly string[], released: readonly string[]): ThroughputDay[] {
  const series = new Map(days.map((day) => [day, { day, received: 0, released: 0 }]));
  const add = (stamps: readonly string[], key: 'received' | 'released') => {
    for (const stamp of stamps) {
      const date = new Date(stamp);
      if (Number.isNaN(date.getTime())) continue;
      const bucket = series.get(utcDay(date));
      if (bucket) bucket[key] += 1;
    }
  };
  add(received, 'received');
  add(released, 'released');
  return [...series.values()];
}

function learnerLabel(profile: Record<string, unknown> | null): string | null {
  const name = text(profile?.display_name);
  if (name) return name;
  const handle = text(profile?.handle);
  return handle ? `@${handle}` : null;
}

/** The outline title of an item, or null when the outline does not name it. */
function itemTitleOrNull(map: ReadonlyMap<string, VersionTitles>, versionId: string | null, itemId: string, locale: Locale): string | null {
  if (!versionId || !map.get(versionId.toLowerCase())?.items.has(itemId)) return null;
  return resolveItemTitle(map, versionId, itemId, locale);
}

export async function gradingOverview(
  { actor, scope, locale }: GradingOverviewInput,
  dependencies: GradingOverviewDependencies = {},
): Promise<GradingOverview> {
  const now = dependencies.now?.() ?? new Date();
  const queue = dependencies.queue ?? readQueue;
  const loadTitles = dependencies.titles ?? versionTitles;
  const loadActors = dependencies.actors ?? ((ids: Iterable<string | null | undefined>) => actorDisplayNames(ids));
  let cachedDatabase: OverviewDatabase | undefined = dependencies.database;
  const database = () => {
    cachedDatabase ??= supabaseService() as unknown as OverviewDatabase;
    return cachedDatabase;
  };

  const scoped = <Q extends OverviewQuery>(query: Q, prefix = ''): Q => {
    if (scope.global) return query;
    const branchScoped = query.eq(`${prefix}branch_scope_known`, true);
    return scope.branchIds.length === 1
      ? branchScoped.eq(`${prefix}branch_id`, scope.branchIds[0])
      : branchScoped.in(`${prefix}branch_id`, scope.branchIds);
  };
  const count = async (build: () => OverviewQuery): Promise<number> => {
    const result = await build();
    if (result.error || typeof result.count !== 'number') throw new Error('Grading overview count failed');
    return result.count;
  };
  const submissionCount = (status: SubmissionStatus) => count(() => scoped(database()
    .from('assignment_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', status)));
  const releasedCount = (from: Date, to: Date) => count(() => {
    const base = database().from('grades')
      .select(scope.global ? 'id' : 'id,assignment_submissions!inner(branch_id,branch_scope_known)', { count: 'exact', head: true })
      .eq('released', true)
      .gte('graded_at', from.toISOString())
      .lt('graded_at', to.toISOString());
    return scoped(base, 'assignment_submissions.');
  });
  /**
   * All timestamps of one series. A head count comes first: past the cap the series is reported
   * unavailable without paging, otherwise every page is read in parallel.
   */
  const pagedStamps = async (build: (head: boolean) => OverviewQuery, order: (query: OverviewQuery) => OverviewQuery, column: string): Promise<string[]> => {
    const head = await build(true);
    if (head.error || typeof head.count !== 'number') throw new Error('Grading throughput count failed');
    // More rows than the cap: a partial series would under-count, so report it unavailable.
    if (head.count > THROUGHPUT_ROW_CAP) throw new Error('Grading throughput exceeds the row cap');
    // One page more than the count needs, so rows added since the count are still read.
    const pages = Math.floor(head.count / ROW_PAGE) + 1;
    const results = await Promise.all(Array.from({ length: pages }, (_, index) =>
      order(build(false)).range(index * ROW_PAGE, index * ROW_PAGE + ROW_PAGE - 1)));
    const stamps: string[] = [];
    for (const result of results) {
      if (result.error || !Array.isArray(result.data)) throw new Error('Grading throughput read failed');
      for (const row of result.data) {
        const stamp = text(record(row)?.[column]);
        if (stamp) stamps.push(stamp);
      }
    }
    return stamps;
  };

  // The scope is a single branch when the grader works inside one; the queue then filters to it.
  const queueFilter: SubmissionQueueFilter = { status: 'pending', ...(!scope.global && scope.branchIds.length === 1 ? { branchId: scope.branchIds[0] } : {}) };
  const days = throughputDays(now);
  const since = new Date(`${days[0]}T00:00:00.000Z`).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [statusCounts, examsAwaitingManual, gradedLast7Days, gradedPrior7Days, oldestPage, throughput, recentRows] = await Promise.all([
    settle(async () => {
      const counts = await Promise.all(OVERVIEW_STATUSES.map(submissionCount));
      return Object.fromEntries(OVERVIEW_STATUSES.map((status, index) => [status, counts[index]])) as Record<SubmissionStatus, number>;
    }),
    settle(() => count(() => scoped(database()
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_manual')))),
    settle(() => releasedCount(weekAgo, now)),
    settle(() => releasedCount(twoWeeksAgo, weekAgo)),
    settle(async () => {
      // The Waiting filter is narrowed in the database, but a page can still come back empty
      // with a cursor (post-fetch filters). Read a few more pages before giving up, and then
      // report the list unavailable rather than claiming nothing is waiting.
      let page = await queue(actor, queueFilter);
      const items = [...page.items];
      for (let extra = 0; !items.length && page.nextCursor && extra < OLDEST_EXTRA_PAGES; extra += 1) {
        page = await queue(actor, { ...queueFilter, cursor: page.nextCursor });
        items.push(...page.items);
      }
      if (!items.length && page.nextCursor) throw new Error('Oldest waiting submission not found within the read limit');
      return items;
    }),
    settle(async () => {
      const headOptions = (head: boolean) => head ? { count: 'exact' as const, head: true } : undefined;
      const [received, released] = await Promise.all([
        pagedStamps((head) => scoped(database()
          .from('assignment_submissions')
          .select('submitted_at', headOptions(head))
          .gte('submitted_at', since)),
        (query) => query.order('submitted_at', { ascending: true }).order('id', { ascending: true }), 'submitted_at'),
        pagedStamps((head) => scoped(database()
          .from('grades')
          .select(scope.global ? 'graded_at' : 'graded_at,assignment_submissions!inner(branch_id,branch_scope_known)', headOptions(head))
          .eq('released', true)
          .gte('graded_at', since), 'assignment_submissions.'),
        (query) => query.order('graded_at', { ascending: true }).order('id', { ascending: true }), 'graded_at'),
      ]);
      return bucketByDay(days, received, released);
    }),
    settle(async () => {
      const result = await scoped(database()
        .from('grades')
        .select('id,submission_id,grader_id,decision,released,graded_at,assignment_submissions!inner(id,user_id,course_version_id,item_id,branch_id,branch_scope_known,profiles(display_name,handle))')
        .order('graded_at', { ascending: false })
        .limit(RECENT_GRADES_LIMIT), 'assignment_submissions.');
      if (result.error || !Array.isArray(result.data)) throw new Error('Recent grades read failed');
      return result.data.flatMap((raw) => {
        const row = record(raw);
        const submission = first(row?.assignment_submissions);
        const id = text(row?.id);
        const submissionId = text(row?.submission_id) ?? text(submission?.id);
        const gradedAt = text(row?.graded_at);
        const decision = row?.decision;
        if (!row || !id || !submissionId || !gradedAt || (decision !== 'approved' && decision !== 'changes_requested')) return [];
        return [{
          id,
          submissionId,
          graderId: text(row.grader_id),
          decision: decision as RecentGrade['decision'],
          released: row.released === true,
          gradedAt,
          courseVersionId: text(submission?.course_version_id),
          itemId: text(submission?.item_id),
          learnerName: learnerLabel(first(submission?.profiles)),
        }];
      });
    }),
  ]);

  const oldestItems: SubmissionQueueSubmission[] | null = oldestPage ? oldestPage.slice(0, OLDEST_WAITING_LIMIT) : null;
  const titleMap: Map<string, VersionTitles> = await loadTitles([
    ...(oldestItems ?? []).map((item) => item.courseVersionId),
    ...(recentRows ?? []).map((row) => row.courseVersionId),
  ]).catch(() => new Map<string, VersionTitles>());
  const graders = recentRows?.length
    ? await loadActors(recentRows.map((row) => row.graderId)).catch(() => new Map<string, ActorDisplay>())
    : new Map<string, ActorDisplay>();
  const back = routes.grading.queue({ status: 'pending' });

  return {
    generatedAt: now.toISOString(),
    statusCounts,
    waiting: statusCounts ? statusCounts.submitted + statusCounts.in_review : null,
    examsAwaitingManual,
    gradedLast7Days,
    gradedPrior7Days,
    oldest: oldestItems?.map((item) => ({
      id: item.id,
      // The queue falls back to the raw user id when a learner has no name or handle.
      learnerName: item.learnerName && item.learnerName !== item.userId ? item.learnerName : null,
      courseTitle: resolveCourseTitle(titleMap, item.courseVersionId, locale, '') || null,
      itemTitle: itemTitleOrNull(titleMap, item.courseVersionId, item.itemId, locale),
      status: item.status,
      submittedAt: item.submittedAt,
      href: routes.grading.assignment(item.id, { ...(item.branchId ? { branchId: item.branchId } : {}), back }),
    })) ?? null,
    throughput,
    recent: recentRows?.map((row) => {
      const grader = row.graderId ? graders.get(row.graderId.toLowerCase()) : undefined;
      return {
        id: row.id,
        graderName: grader?.name ?? null,
        graderAvatarUrl: grader?.avatarUrl ?? null,
        learnerName: row.learnerName,
        itemTitle: row.itemId ? itemTitleOrNull(titleMap, row.courseVersionId, row.itemId, locale) : null,
        released: row.released,
        decision: row.decision,
        gradedAt: row.gradedAt,
        href: routes.grading.assignment(row.submissionId),
      };
    }) ?? null,
  };
}

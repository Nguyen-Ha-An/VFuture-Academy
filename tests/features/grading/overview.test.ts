import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => { throw new Error('no database in tests'); }) }));

import {
  bucketByDay,
  gradingOverview,
  throughputDays,
  THROUGHPUT_ROW_CAP,
  type OverviewDatabase,
  type OverviewQuery,
} from '@/features/grading/overview';
import type { VersionTitles } from '@/features/grading/titles';
import type { SubmissionQueueSubmission } from '@/features/submissions/contracts';
import type { Actor } from '@/lib/permissions';

type Result = { data: unknown; error: unknown; count?: number | null };
type Operation = [string, ...unknown[]];

class QueryStub implements OverviewQuery {
  readonly operations: Operation[] = [];
  constructor(readonly table: string, private readonly resolve: (query: QueryStub) => Result) {}
  select(columns: string, options?: unknown) { this.operations.push(['select', columns, options]); return this; }
  eq(column: string, value: unknown) { this.operations.push(['eq', column, value]); return this; }
  in(column: string, values: unknown[]) { this.operations.push(['in', column, values]); return this; }
  gte(column: string, value: string) { this.operations.push(['gte', column, value]); return this; }
  lt(column: string, value: string) { this.operations.push(['lt', column, value]); return this; }
  order(column: string, options?: unknown) { this.operations.push(['order', column, options]); return this; }
  limit(count: number) { this.operations.push(['limit', count]); return this; }
  range(from: number, to: number) { this.operations.push(['range', from, to]); return this; }
  has(...operation: Operation) { return this.operations.some((entry) => JSON.stringify(entry) === JSON.stringify(operation)); }
  get isCount() { return this.operations.some(([name, , options]) => name === 'select' && (options as { head?: boolean } | undefined)?.head === true); }
  then<T1 = Result, T2 = never>(onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null, onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve().then(() => this.resolve(this)).then(onfulfilled, onrejected);
  }
}

function database(resolve: (query: QueryStub) => Result) {
  const queries: QueryStub[] = [];
  const db: OverviewDatabase = {
    from(table: string) {
      const query = new QueryStub(table, resolve);
      queries.push(query);
      return query;
    },
  };
  return { db, queries };
}

const NOW = new Date('2026-09-25T12:00:00.000Z');
const grader: Actor = { userId: 'teacher-1', roles: [{ role: 'instructor', branchId: 'school-a' }] };
const VERSION = '11111111-1111-4111-8111-111111111111';
const counts: Record<string, number> = { submitted: 7, in_review: 2, approved: 40, changes_requested: 3 };

function defaultResolve(query: QueryStub): Result {
  if (query.isCount) {
    if (query.table === 'assignment_submissions') {
      const status = query.operations.find(([name, column]) => name === 'eq' && column === 'status')?.[2] as string | undefined;
      // Without a status filter it is the throughput head count.
      return { data: null, error: null, count: status ? counts[status] : 3 };
    }
    if (query.table === 'exam_attempts') return { data: null, error: null, count: 4 };
    if (query.table === 'grades') return { data: null, error: null, count: query.has('lt', 'graded_at', NOW.toISOString()) ? 12 : 9 };
  }
  if (query.table === 'assignment_submissions') {
    return { data: [{ submitted_at: '2026-09-25T01:00:00.000Z' }, { submitted_at: '2026-09-24T23:59:59.000Z' }, { submitted_at: '2026-08-01T00:00:00.000Z' }], error: null };
  }
  if (query.table === 'grades' && query.operations.some(([name]) => name === 'limit')) {
    return {
      data: [{
        id: 'grade-1', submission_id: 'submission-2', grader_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', decision: 'approved', released: true,
        graded_at: '2026-09-25T10:00:00.000Z',
        assignment_submissions: { id: 'submission-2', user_id: 'learner-2', course_version_id: VERSION, item_id: 'lesson-2', profiles: { display_name: 'Lê Văn Bình' } },
      }, {
        id: 'grade-2', submission_id: 'submission-3', grader_id: null, decision: 'changes_requested', released: false,
        graded_at: '2026-09-25T09:00:00.000Z',
        assignment_submissions: { id: 'submission-3', user_id: 'learner-3', course_version_id: VERSION, item_id: 'lesson-9', profiles: { handle: 'hoa' } },
      }],
      error: null,
    };
  }
  if (query.table === 'grades') return { data: [{ graded_at: '2026-09-25T08:00:00.000Z' }], error: null };
  return { data: null, error: { message: `unexpected ${query.table}` } };
}

function waitingItem(overrides: Partial<SubmissionQueueSubmission> = {}): SubmissionQueueSubmission {
  return {
    id: 'submission-old', userId: 'learner-1', learnerName: 'Nguyễn Minh Anh', branchId: 'school-a',
    courseVersionId: VERSION, itemId: 'lesson-1', blockId: null, assignmentId: 'lesson-1', attemptNo: 1,
    status: 'submitted', submittedAt: '2026-09-21T09:00:00.000Z', payload: { text: 'Work' }, files: [],
    ...overrides,
  };
}

const titles = vi.fn(async () => new Map<string, VersionTitles>([[VERSION, {
  courseId: 'design-thinking',
  courseTitle: { vi: 'Tư duy thiết kế', en: 'Design thinking' },
  items: new Map<string, VersionTitles['courseTitle']>([['lesson-1', { vi: 'Bài tập 1', en: 'Assignment 1' }], ['lesson-2', 'Bài tập 2']]),
}]]));
const actors = vi.fn(async () => new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { name: 'Trần Thu Hà', avatarUrl: null, initials: 'TH' }]]));

function run(scope: { global: boolean; branchIds: string[] }, resolve = defaultResolve, queue: (actor: Actor, filter: unknown) => Promise<{ items: SubmissionQueueSubmission[]; nextCursor: string | null }> = vi.fn(async () => ({ items: [waitingItem()], nextCursor: null }))) {
  const { db, queries } = database(resolve);
  const result = gradingOverview({ actor: grader, scope, locale: 'en' }, { database: db, queue, titles, actors, now: () => NOW });
  return { result, queries, queue };
}

describe('grading overview reads', () => {
  it('counts each stored status in the grader\'s school and derives waiting from submitted + in review', async () => {
    const { result, queries } = run({ global: false, branchIds: ['school-a'] });
    const overview = await result;

    expect(overview.statusCounts).toEqual(counts);
    expect(overview.waiting).toBe(9);
    expect(overview.examsAwaitingManual).toBe(4);
    const statusCounts = queries.filter((query) => query.table === 'assignment_submissions' && query.isCount
      && query.operations.some(([name, column]) => name === 'eq' && column === 'status'));
    expect(statusCounts).toHaveLength(4);
    for (const query of statusCounts) {
      expect(query.has('eq', 'branch_scope_known', true)).toBe(true);
      expect(query.has('eq', 'branch_id', 'school-a')).toBe(true);
    }
    const exams = queries.find((query) => query.table === 'exam_attempts');
    expect(exams?.has('eq', 'status', 'pending_manual')).toBe(true);
    expect(exams?.has('eq', 'branch_id', 'school-a')).toBe(true);
  });

  it('applies no branch filter for a global grader and an in-list for several schools', async () => {
    const global = run({ global: true, branchIds: [] });
    await global.result;
    expect(global.queries.some((query) => query.operations.some(([, column]) => String(column).endsWith('branch_id')))).toBe(false);

    const several = run({ global: false, branchIds: ['school-a', 'school-b'] });
    await several.result;
    const counted = several.queries.find((query) => query.table === 'assignment_submissions' && query.isCount);
    expect(counted?.has('in', 'branch_id', ['school-a', 'school-b'])).toBe(true);
    const released = several.queries.find((query) => query.table === 'grades' && query.isCount);
    expect(released?.has('in', 'assignment_submissions.branch_id', ['school-a', 'school-b'])).toBe(true);
  });

  it('compares released grades over the last 7 days with the 7 days before, same definition', async () => {
    const { result, queries } = run({ global: false, branchIds: ['school-a'] });
    const overview = await result;

    expect(overview.gradedLast7Days).toBe(12);
    expect(overview.gradedPrior7Days).toBe(9);
    // The two 7-day windows (the throughput head count has no upper bound).
    const windows = queries.filter((query) => query.table === 'grades' && query.isCount && query.operations.some(([name]) => name === 'lt'));
    expect(windows).toHaveLength(2);
    const weekAgo = new Date(NOW.getTime() - 7 * 86_400_000).toISOString();
    const twoWeeksAgo = new Date(NOW.getTime() - 14 * 86_400_000).toISOString();
    expect(windows.some((query) => query.has('gte', 'graded_at', weekAgo) && query.has('lt', 'graded_at', NOW.toISOString()))).toBe(true);
    expect(windows.some((query) => query.has('gte', 'graded_at', twoWeeksAgo) && query.has('lt', 'graded_at', weekAgo))).toBe(true);
    for (const query of windows) expect(query.has('eq', 'released', true)).toBe(true);
  });

  it('turns a failed read into null for that section only', async () => {
    const { result } = run({ global: false, branchIds: ['school-a'] }, (query) => query.table === 'assignment_submissions' && query.isCount
      ? { data: null, error: { message: 'boom' } }
      : defaultResolve(query));
    const overview = await result;

    expect(overview.statusCounts).toBeNull();
    expect(overview.waiting).toBeNull();
    expect(overview.examsAwaitingManual).toBe(4);
    expect(overview.oldest).toHaveLength(1);
  });

  it('reads the five oldest through the queue\'s Waiting filter and resolves their titles', async () => {
    const queue = vi.fn(async () => ({
      items: Array.from({ length: 7 }, (_, index) => waitingItem({ id: `submission-${index}` })),
      nextCursor: null,
    }));
    const { result } = run({ global: false, branchIds: ['school-a'] }, defaultResolve, queue);
    const overview = await result;

    expect(queue).toHaveBeenCalledWith(grader, { status: 'pending', branchId: 'school-a' });
    expect(overview.oldest).toHaveLength(5);
    expect(overview.oldest?.[0]).toMatchObject({
      id: 'submission-0', courseTitle: 'Design thinking', itemTitle: 'Assignment 1',
      href: '/grading/assignments/submission-0?branchId=school-a&back=%2Fgrading%2Fqueue%3Fstatus%3Dpending',
    });
  });

  it('reports the oldest list unavailable when the queue read fails', async () => {
    const { result } = run({ global: true, branchIds: [] }, defaultResolve, vi.fn(async () => { throw new Error('forbidden'); }));
    expect((await result).oldest).toBeNull();
  });

  it('builds a zero-filled 30-day throughput series from received and released rows', async () => {
    const { result, queries } = run({ global: false, branchIds: ['school-a'] });
    const overview = await result;

    expect(overview.throughput).toHaveLength(30);
    expect(overview.throughput?.[0]?.day).toBe('2026-08-27');
    expect(overview.throughput?.at(-1)).toEqual({ day: '2026-09-25', received: 1, released: 1 });
    expect(overview.throughput?.at(-2)).toEqual({ day: '2026-09-24', received: 1, released: 0 });
    const received = queries.find((query) => query.table === 'assignment_submissions' && !query.isCount);
    expect(received?.has('gte', 'submitted_at', '2026-08-27T00:00:00.000Z')).toBe(true);
    expect(received?.has('range', 0, 999)).toBe(true);
  });

  it('reports the throughput unavailable past the row cap without paging', async () => {
    const isThroughputCount = (query: QueryStub) => query.table === 'assignment_submissions' && query.isCount
      && !query.operations.some(([name, column]) => name === 'eq' && column === 'status');
    const { result, queries } = run({ global: true, branchIds: [] }, (query) => isThroughputCount(query)
      ? { data: null, error: null, count: THROUGHPUT_ROW_CAP + 1 }
      : defaultResolve(query));
    expect((await result).throughput).toBeNull();
    expect(queries.filter((query) => query.table === 'assignment_submissions' && !query.isCount)).toHaveLength(0);
  });

  it('reads every throughput page in parallel once the head count is known', async () => {
    const { result, queries } = run({ global: true, branchIds: [] }, (query) => query.table === 'assignment_submissions' && query.isCount
      && !query.operations.some(([name, column]) => name === 'eq' && column === 'status')
      ? { data: null, error: null, count: 2500 }
      : defaultResolve(query));
    await result;
    const pages = queries.filter((query) => query.table === 'assignment_submissions' && !query.isCount);
    expect(pages.map((query) => query.operations.find(([name]) => name === 'range')?.slice(1))).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('keeps reading queue pages when the first one holds no waiting submission', async () => {
    const queue = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [waitingItem({ id: 'submission-late' })], nextCursor: 'c2' });
    const { result } = run({ global: false, branchIds: ['school-a'] }, defaultResolve, queue);
    const overview = await result;
    expect(queue).toHaveBeenNthCalledWith(2, grader, { status: 'pending', branchId: 'school-a', cursor: 'c1' });
    expect(overview.oldest?.map((item) => item.id)).toEqual(['submission-late']);
  });

  it('reports the oldest list unavailable, not empty, when the read limit ends with more pages left', async () => {
    const queue = vi.fn(async () => ({ items: [], nextCursor: 'more' }));
    const { result } = run({ global: true, branchIds: [] }, defaultResolve, queue);
    expect((await result).oldest).toBeNull();
    expect(queue).toHaveBeenCalledTimes(4);
  });

  it('never shows raw ids when a learner, course or item cannot be named', async () => {
    const queue = vi.fn(async () => ({
      items: [waitingItem({ learnerName: 'learner-1', courseVersionId: '22222222-2222-4222-8222-222222222222', itemId: 'unknown-item' })],
      nextCursor: null,
    }));
    const { result } = run({ global: true, branchIds: [] }, defaultResolve, queue);
    expect((await result).oldest?.[0]).toMatchObject({ learnerName: null, courseTitle: null, itemTitle: null });
  });

  it('names graders and learners in the recent grades feed', async () => {
    const { result } = run({ global: false, branchIds: ['school-a'] });
    const overview = await result;

    expect(overview.recent).toEqual([
      expect.objectContaining({ id: 'grade-1', graderName: 'Trần Thu Hà', learnerName: 'Lê Văn Bình', itemTitle: 'Bài tập 2', released: true, href: '/grading/assignments/submission-2' }),
      expect.objectContaining({ id: 'grade-2', graderName: null, learnerName: '@hoa', itemTitle: null, released: false }),
    ]);
  });
});

describe('throughput helpers', () => {
  it('lists UTC days oldest first and ignores stamps outside the window', () => {
    const days = throughputDays(new Date('2026-09-25T23:30:00.000Z'), 3);
    expect(days).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(bucketByDay(days, ['2026-09-22T12:00:00Z', '2026-09-23T00:00:00Z', 'nonsense'], ['2026-09-25T23:59:59Z'])).toEqual([
      { day: '2026-09-23', received: 1, released: 0 },
      { day: '2026-09-24', received: 0, released: 0 },
      { day: '2026-09-25', received: 0, released: 1 },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => { throw new Error('no service client in tests'); }) }));

import { gradingWorkbenchContext, type WorkbenchDatabase, type WorkbenchQuery } from '@/features/grading/detail';
import type { VersionTitles } from '@/features/grading/titles';
import type { SubmissionQueuePage, SubmissionQueueSubmission } from '@/features/submissions/contracts';
import type { Actor, Permission } from '@/lib/permissions';

const VERSION = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';
const OLDER = '44444444-4444-4444-8444-444444444444';

function actor(permissions: Permission[], branchId: string | null = 'school-a'): Actor {
  return {
    userId: 'grader-1',
    roles: [],
    authorization: {
      source: 'database',
      accountStatus: 'active',
      memberships: branchId ? [{ branchId, status: 'active' }] : [],
      assignments: [{
        roleDefinitionId: 'role',
        scope: branchId ? { kind: 'branch', branchId } : { kind: 'central' },
        permissions,
      }],
    },
  } as unknown as Actor;
}

type Call = { table: string; ops: Array<[string, unknown[]]> };

/** A chainable stand-in for the Supabase builder; `resolve` answers each finished query. */
function fakeDatabase(resolve: (call: Call) => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const database: WorkbenchDatabase = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder = {} as WorkbenchQuery;
      for (const name of ['select', 'eq', 'is', 'or', 'order', 'limit'] as const) {
        (builder as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => { call.ops.push([name, args]); return builder; };
      }
      builder.maybeSingle = () => Promise.resolve(resolve(call));
      (builder as unknown as { then: PromiseLike<unknown>['then'] }).then = (onFulfilled, onRejected) =>
        Promise.resolve(resolve(call)).then(onFulfilled, onRejected);
      return builder;
    },
  };
  return { database, calls };
}

function titles(): Promise<Map<string, VersionTitles>> {
  return Promise.resolve(new Map([[VERSION, {
    courseId: 'course-a',
    courseTitle: { vi: 'Tư duy thiết kế', en: 'Design thinking' },
    items: new Map<string, VersionTitles['courseTitle']>([['lesson-1', { vi: 'Bài tập tuần 1', en: 'Week 1 reflection' }], ['exam-1', 'Midterm exam']]),
  }]]));
}

function row(id: string, overrides: Partial<SubmissionQueueSubmission> = {}): SubmissionQueueSubmission {
  return {
    id, userId: 'learner', learnerName: 'Learner', branchId: 'school-a', courseVersionId: VERSION, itemId: 'lesson-1',
    blockId: null, assignmentId: 'lesson-1', attemptNo: 1, status: 'submitted', submittedAt: '2026-09-20T00:00:00+00:00',
    payload: {}, files: [], ...overrides,
  };
}

const submissionRow = { id: CURRENT, course_version_id: VERSION, item_id: 'lesson-1', submitted_at: '2026-09-10T08:00:00+00:00', branch_id: 'school-a', branch_scope_known: true };

describe('grading workbench context · assignments', () => {
  it('resolves localized titles and the next oldest waiting submission after this one', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const queue = vi.fn(async (_actor: Actor, _filter: unknown): Promise<SubmissionQueuePage> => ({ items: [row(NEXT)], nextCursor: null }));
    const back = '/grading/queue?branchId=school-a&courseId=course-a&assignmentId=lesson-1&status=pending';

    const result = await gradingWorkbenchContext({
      kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en',
      search: { branchId: 'school-a', courseId: 'course-a', assignmentId: 'lesson-1', status: 'pending', back },
    }, { database, queue, titles });

    expect(result.titles).toEqual({ course: 'Design thinking', item: 'Week 1 reflection' });
    const filter = queue.mock.calls[0][1] as unknown as Record<string, string>;
    expect(filter).toMatchObject({ status: 'pending', branchId: 'school-a', courseId: 'course-a', assignmentId: 'lesson-1' });
    // Keyset cursor strictly after this submission, in the queue's own encoding.
    expect(JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8'))).toEqual({ submittedAt: submissionRow.submitted_at, id: CURRENT });
    const next = new URL(result.nextHref!, 'http://x');
    expect(next.pathname).toBe(`/grading/assignments/${NEXT}`);
    expect(next.searchParams.get('back')).toBe(back);
    expect(next.searchParams.get('status')).toBe('pending');
  });

  it('localizes titles for Vietnamese', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'vi' },
      { database, queue: async () => ({ items: [], nextCursor: null }), titles },
    );
    expect(result.titles).toEqual({ course: 'Tư duy thiết kế', item: 'Bài tập tuần 1' });
  });

  it('wraps to the oldest other waiting submission when none waits after this one, never itself', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const queue = vi.fn(async (_actor: Actor, filter: { cursor?: string }): Promise<SubmissionQueuePage> => filter.cursor
      ? { items: [], nextCursor: null }
      : { items: [row(CURRENT), row(OLDER)], nextCursor: null });

    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en', scopeBranchId: 'school-a' },
      { database, queue, titles },
    );

    expect(queue).toHaveBeenCalledTimes(2);
    expect(queue.mock.calls[1][1]).toEqual({ status: 'pending', branchId: 'school-a' });
    expect(result.nextHref).toContain(`/grading/assignments/${OLDER}`);
  });

  it('follows the queue cursor past pages the waiting filter leaves empty', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const queue = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: [row(NEXT)], nextCursor: null });
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, queue, titles },
    );
    expect(queue.mock.calls[1][1]).toMatchObject({ cursor: 'page-2' });
    expect(result.nextHref).toContain(NEXT);
  });

  it('says nothing is next when the queue is empty', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, queue: async () => ({ items: [row(CURRENT)], nextCursor: null }), titles },
    );
    expect(result.nextHref).toBeNull();
    expect(result.titles).not.toBeNull();
  });

  it('drops an unsafe back link from the next link', async () => {
    const { database } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en', search: { back: 'https://evil.example' } },
      { database, queue: async () => ({ items: [row(NEXT)], nextCursor: null }), titles },
    );
    expect(result.nextHref).toBe(`/grading/assignments/${NEXT}?branchId=school-a`);
  });

  it('reveals nothing about a submission outside the grader\'s schools', async () => {
    const { database } = fakeDatabase(() => ({ data: { ...submissionRow, branch_id: 'school-b' }, error: null }));
    const queue = vi.fn();
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, queue, titles },
    );
    expect(result).toEqual({ titles: null, nextHref: null });
    expect(queue).not.toHaveBeenCalled();
  });

  it('treats a submission with unknown school history as global-only, like the detail service', async () => {
    const { database } = fakeDatabase(() => ({ data: { ...submissionRow, branch_scope_known: false }, error: null }));
    const queue = vi.fn();
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, queue, titles },
    );
    expect(result).toEqual({ titles: null, nextHref: null });
    expect(queue).not.toHaveBeenCalled();
  });

  it('never throws: failed reads leave both parts empty', async () => {
    const { database } = fakeDatabase(() => ({ data: null, error: { message: 'down' } }));
    await expect(gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, queue: vi.fn(), titles },
    )).resolves.toEqual({ titles: null, nextHref: null });

    const { database: ok } = fakeDatabase(() => ({ data: submissionRow, error: null }));
    const result = await gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database: ok, queue: async () => { throw new Error('queue down'); }, titles: async () => { throw new Error('titles down'); } },
    );
    expect(result).toEqual({ titles: null, nextHref: null });

    await expect(gradingWorkbenchContext(
      { kind: 'assignments', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
    )).resolves.toEqual({ titles: null, nextHref: null });
  });
});

describe('grading workbench context · exams', () => {
  const attemptRow = { id: CURRENT, course_version_id: VERSION, item_id: 'exam-1', branch_id: 'school-a', branch_scope_known: true, submitted_at: '2026-09-10T08:00:00+00:00' };

  it('links the next pending manual attempt of the same exam and school', async () => {
    // The attempt lookup is a single row; the next-attempt read is the one that sets a limit.
    const { database, calls } = fakeDatabase((call) => call.ops.some(([name]) => name === 'limit')
      ? { data: [{ id: NEXT, branch_id: 'school-a', submitted_at: '2026-09-11T00:00:00+00:00' }], error: null }
      : { data: attemptRow, error: null });
    const back = '/grading/assessments?branchId=school-a&courseId=course-a&exam=x';

    const result = await gradingWorkbenchContext({
      kind: 'exams', id: CURRENT, actor: actor(['submission.grade']), locale: 'en',
      search: { branchId: 'school-a', courseId: 'course-a', exam: `${VERSION}:exam-1`, back },
    }, { database, titles });

    expect(result.titles).toEqual({ course: 'Design thinking', item: 'Midterm exam' });
    const nextQuery = calls.find((call) => call.ops.some(([name]) => name === 'limit'))!;
    expect(nextQuery.table).toBe('exam_attempts');
    expect(nextQuery.ops).toEqual(expect.arrayContaining([
      ['eq', ['status', 'pending_manual']],
      ['eq', ['course_version_id', VERSION]],
      ['eq', ['item_id', 'exam-1']],
      ['eq', ['branch_id', 'school-a']],
      ['or', [`submitted_at.gt.${attemptRow.submitted_at},and(submitted_at.eq.${attemptRow.submitted_at},id.gt.${CURRENT})`]],
    ]));
    const next = new URL(result.nextHref!, 'http://x');
    expect(next.pathname).toBe(`/grading/exams/${NEXT}`);
    expect(next.searchParams.get('back')).toBe(back);
    expect(next.searchParams.get('exam')).toBe(`${VERSION}:exam-1`);
  });

  it('hides an exam attempt whose school history is unknown from a school grader', async () => {
    const { database } = fakeDatabase(() => ({ data: { ...attemptRow, branch_scope_known: false }, error: null }));
    await expect(gradingWorkbenchContext(
      { kind: 'exams', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, titles },
    )).resolves.toEqual({ titles: null, nextHref: null });
  });

  it('hides an exam attempt from a grader without access to its school', async () => {
    const { database } = fakeDatabase(() => ({ data: { ...attemptRow, branch_id: 'school-b' }, error: null }));
    await expect(gradingWorkbenchContext(
      { kind: 'exams', id: CURRENT, actor: actor(['submission.grade']), locale: 'en' },
      { database, titles },
    )).resolves.toEqual({ titles: null, nextHref: null });
  });
});

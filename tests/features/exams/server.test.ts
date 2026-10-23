import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recompute: vi.fn(),
  supabaseService: vi.fn(),
  repo: {
    listStudioAttempts: vi.fn(),
    listAnswers: vi.fn(),
    countUnassignedStudioAttempts: vi.fn(),
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/progress/service', () => ({ recompute: mocks.recompute }));
vi.mock('@/features/exams/supabase-repo', () => ({
  SupabaseExamRepo: class {
    listStudioAttempts = mocks.repo.listStudioAttempts;
    listAnswers = mocks.repo.listAnswers;
    countUnassignedStudioAttempts = mocks.repo.countUnassignedStudioAttempts;
  },
}));

import {
  createExamEnrollmentChecker,
  createExamProgressHook,
  listStudioExamAttempts,
  studioExamActor,
} from '@/features/exams/server';
import type { Actor } from '@/lib/permissions';

class EnrollmentQuery {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly data: unknown, private readonly error: unknown = null) {}
  select(columns: string) { this.calls.push(['select', columns]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  in(column: string, values: unknown[]) { this.calls.push(['in', column, values]); return this; }
  maybeSingle() { return Promise.resolve({ data: this.data, error: this.error }); }
}

describe('exam server composition', () => {
  it('resolves the attempt course and recomputes progress for its learner', async () => {
    const query = new EnrollmentQuery({ course_id: 'course-1' });
    const hook = createExamProgressHook({ from: vi.fn(() => query) } as never);
    mocks.recompute.mockResolvedValue(undefined);

    await hook({ userId: 'learner-1', courseVersionId: 'version-1' } as never);

    expect(query.calls).toEqual([
      ['select', 'course_id'],
      ['eq', 'id', 'version-1'],
    ]);
    expect(mocks.recompute).toHaveBeenCalledWith(
      { userId: 'learner-1', roles: [] },
      'course-1',
    );
  });

  it('rechecks enrollment by user, exact course version, and active lifecycle statuses', async () => {
    const query = new EnrollmentQuery({ course_version_id: 'version-1',branch_id:null,branch_scope_known:false });
    const checker = createExamEnrollmentChecker({ from: vi.fn(() => query) } as never);

    await expect(checker('learner-1', 'version-1')).resolves.toBe(true);
    expect(query.calls).toEqual([
      ['select', 'course_version_id,branch_id,branch_scope_known'],
      ['eq', 'user_id', 'learner-1'],
      ['eq', 'course_version_id', 'version-1'],
      ['in', 'status', ['active', 'completed']],
    ]);
  });

  it('fails a live enrollment recheck closed when trusted branch membership lookup fails',async()=>{
    const enrollment=new EnrollmentQuery({course_version_id:'version-1',branch_id:'school-a',branch_scope_known:true});
    const membership=new EnrollmentQuery(null,new Error('offline'));
    const from=vi.fn((table:string)=>table==='enrollments'?enrollment:membership);
    const checker=createExamEnrollmentChecker({from} as never);
    await expect(checker('learner-1','version-1')).rejects.toMatchObject({status:503,code:'MEMBERSHIP_ACCESS_UNAVAILABLE'});
    expect(from).toHaveBeenCalledWith('branch_memberships');
  });

  it('grants a studio actor only the verified permission and marks only global admins global', () => {
    const globalAdmin: Actor = {
      userId: 'admin-1',
      roles: [{ role: 'admin', branchId: null }],
    };
    const scopedInstructor: Actor = {
      userId: 'instructor-1',
      roles: [{ role: 'instructor', branchId: 'branch-1' }],
    };

    expect(studioExamActor(globalAdmin, 'branch-1', 'submission.grade')).toEqual({
      id: 'admin-1',
      locale: 'vi',
      permissions: ['submission.grade'],
      branchId: 'branch-1',
      global: true,
    });
    expect(studioExamActor(scopedInstructor, 'branch-1', 'exam.release')).toEqual({
      id: 'instructor-1',
      locale: 'vi',
      permissions: ['exam.release'],
      branchId: 'branch-1',
      global: false,
    });
  });

  it('limits the manual-answer fan-out to the first 50 attempts', async () => {
    const actor: Actor = {
      userId: 'instructor-1',
      roles: [{ role: 'instructor', branchId: 'branch-1' }],
    };
    mocks.repo.listStudioAttempts.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({
      attempt: {
        id: `attempt-${index}`, userId: `learner-${index}`, courseVersionId: 'version-1', itemId: 'exam-one',
        branchId: 'branch-1', attemptNo: index + 1, status: 'pending_manual', late: false,
        questionSet: {}, gradingSnapshot: { questions: {} }, startedAt: new Date('2026-09-03T03:00:00.000Z'),
        deadlineAt: null, submittedAt: new Date('2026-09-03T04:00:00.000Z'), points: null,
        maxPoints: null, percent: null, releasedAt: null,
      },
      eventCount: 0,
      learnerName: `Learner ${index}`,
    })));
    mocks.repo.listAnswers.mockResolvedValue([]);
    mocks.repo.countUnassignedStudioAttempts.mockResolvedValue(0);

    const result = await listStudioExamAttempts(actor, 'exam-one', 'branch-1', 'version-1');

    expect(result.attempts).toHaveLength(50);
    expect(mocks.repo.listAnswers).toHaveBeenCalledTimes(50);
  });
});

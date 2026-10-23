import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));

import {
  createAdminAnalyticsService,
  type AnalyticsRepository,
  type BranchCourseDailyRow,
  type BranchDailyRow,
  type FailedQuestion,
} from '@/features/admin/analytics';
import type { Actor } from '@/lib/permissions';

const admin: Actor = { userId: 'admin-1', roles: [{ role: 'admin', branchId: null }] };
const lead: Actor = { userId: 'lead-1', roles: [{ role: 'branch_lead', branchId: 'vinsmc' }] };

function repository(
  daily: BranchDailyRow[],
  courses: BranchCourseDailyRow[],
  failed: FailedQuestion[],
  pending = 4,
): AnalyticsRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async daily(branchId, from, to) { calls.push(`daily:${branchId}:${from}:${to}`); return daily; },
    async courses(branchId, from, to) { calls.push(`courses:${branchId}:${from}:${to}`); return courses; },
    async pending(branchId) { calls.push(`pending:${branchId}`); return pending; },
    async topFailed(branchId, from, to) { calls.push(`failed:${branchId}:${from}:${to}`); return failed; },
  };
}

describe('branch analytics service', () => {
  it('aggregates a 30-day branch snapshot and weighted per-course score averages', async () => {
    const repo = repository([
      {
        branchId: 'vinsmc', day: '2026-09-02', activeLearners7d: 4, activeLearners30d: 8,
        enrollments: 2, lessonProgressTotal: 5, lessonCompletions: 3,
        quizAttempts: 2, examAttempts: 1,
      },
      {
        branchId: 'vinsmc', day: '2026-09-03', activeLearners7d: 5, activeLearners30d: 10,
        enrollments: 1, lessonProgressTotal: 3, lessonCompletions: 2,
        quizAttempts: 1, examAttempts: 2,
      },
    ], [
      { branchId: 'vinsmc', courseId: 'ai-1', day: '2026-09-02', quizAttempts: 2, examAttempts: 0, averagePercent: 80, scoreSum: 80, scoreCount: 1 },
      { branchId: 'vinsmc', courseId: 'ai-1', day: '2026-09-03', quizAttempts: 0, examAttempts: 1, averagePercent: 40, scoreSum: 40, scoreCount: 1 },
      { branchId: 'vinsmc', courseId: 'web-1', day: '2026-09-03', quizAttempts: 1, examAttempts: 1, averagePercent: 75, scoreSum: 150, scoreCount: 2 },
    ], [
      { courseId: 'ai-1', questionId: 'q-hard', failures: 7, attempts: 10, failureRate: 70 },
    ]);
    const service = createAdminAnalyticsService({ repository: repo, now: () => new Date('2026-09-03T12:00:00.000Z') });

    const result = await service.branch(lead, 'vinsmc');

    expect(result).toEqual({
      branchId: 'vinsmc',
      period: { from: '2026-08-05', to: '2026-09-03' },
      activeLearners: { days7: 5, days30: 10 },
      enrollments: 3,
      lessonCompletionRate: 62.5,
      attempts: { quiz: 3, exam: 3 },
      pendingGradingCount: 4,
      courses: [
        { courseId: 'ai-1', quizAttempts: 2, examAttempts: 1, averagePercent: 60 },
        { courseId: 'web-1', quizAttempts: 1, examAttempts: 1, averagePercent: 75 },
      ],
      topFailedQuestions: [{ courseId: 'ai-1', questionId: 'q-hard', failures: 7, attempts: 10, failureRate: 70 }],
    });
  });

  it('denies a branch lead outside their branch before querying and allows an admin any branch', async () => {
    const repo = repository([], [], []);
    const service = createAdminAnalyticsService({ repository: repo, now: () => new Date('2026-09-03T00:00:00.000Z') });

    await expect(service.branch(lead, 'ans')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(repo.calls).toEqual([]);
    await expect(service.branch(admin, 'ans')).resolves.toMatchObject({ branchId: 'ans' });
    expect(repo.calls).toHaveLength(4);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createStudioReportingService,
  studioReportQueryFromUrl,
} from '@/features/reporting/service';
import type { Actor } from '@/lib/permissions';
import type { StudioLearningReport } from '@/features/reporting/contracts';

const branchActor: Actor = {
  userId: 'reporter', roles: [], authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'school-a', status: 'active' }],
    assignments: [{ roleDefinitionId: 'reporter', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['report.branch.read'] }],
  },
};

const emptyReport = {
  overview: {
    activeUsers: 0, newEnrollments: 0,
    cohort: { enrollments: 0, completedByPeriodEnd: 0, completionRate: null },
    attempts: { quiz: 0, exam: 0, assignment: 0 },
    averages: { quiz: { percent: null, sampleSize: 0 }, exam: { percent: null, sampleSize: 0 }, assignment: { percent: null, sampleSize: 0 } },
    passRates: { quiz: { percent: null, sampleSize: 0 }, exam: { percent: null, sampleSize: 0 }, assignment: { percent: null, sampleSize: 0 } },
  },
  courses: [], questions: [],
  grading: { asOf: '2026-09-07T00:00:00.000Z', label: 'current', assignments: { pending: 0, unpublished: 0 }, exams: { pendingManualAttempts: 0, pendingManualQuestions: 0, unpublished: 0 } },
} satisfies Omit<StudioLearningReport, 'period' | 'filters' | 'visibility'>;

describe('Studio learning report service', () => {
  it('defaults to 30 Ho Chi Minh calendar days and released results', async () => {
    const report = vi.fn(async () => emptyReport);
    const service = createStudioReportingService({ report, now: () => new Date('2026-09-07T01:00:00Z') });
    const result = await service.load(branchActor, { kind: 'branch', branchId: 'school-a' }, {});
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 'school-a', from: '2026-08-09', to: '2026-09-07', publication: 'released', includeUnknownHistoricalBranch: false,
    }));
    expect(result.period.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('rejects a branch override outside the selected authorized scope', async () => {
    const service = createStudioReportingService({ report: vi.fn(async () => emptyReport) });
    await expect(service.load(branchActor, { kind: 'branch', branchId: 'school-a' }, { branchId: 'school-b' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('rejects inverted or overlong date ranges', () => {
    expect(() => studioReportQueryFromUrl('https://example.test?from=2026-09-07&to=2026-09-01')).toThrow();
    expect(() => studioReportQueryFromUrl('https://example.test?from=2025-01-01&to=2026-09-01')).toThrow();
  });
});

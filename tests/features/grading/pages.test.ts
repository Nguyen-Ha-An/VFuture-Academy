import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import type { GradingOverview } from '@/features/grading/overview';
import type { GradingWorkbenchHeader } from '@/features/grading/detail';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  overview: vi.fn(),
  workbench: vi.fn(async (): Promise<GradingWorkbenchHeader> => ({ titles: null, nextHref: Promise.resolve(null) })),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ forbidden: mocks.forbidden, redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('@/features/workspace/context', () => ({ gradingPageContext: mocks.context }));
vi.mock('@/features/grading/overview', () => ({ gradingOverview: mocks.overview }));
vi.mock('@/features/grading/detail', () => ({ gradingWorkbenchHeader: mocks.workbench }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('@/features/reporting/ui/LearningReports', () => ({ LearningReports: vi.fn(() => null) }));
vi.mock('@/features/instructor-grading/GradingWorkbench', () => ({ GradingWorkbench: vi.fn(() => null) }));

import GradingOverviewPage from '@/app/grading/page';
import LearningReportsPage from '@/app/grading/reports/page';
import GradingAssignmentPage from '@/app/grading/assignments/[id]/page';
import GradingExamPage from '@/app/grading/exams/[id]/page';
import type { Permission } from '@/lib/permissions';

function context(permissions: Permission[], scope: 'central' | 'branch' = 'branch') {
  return {
    workspace: 'grading' as const,
    actor: {
      userId: 'teacher-1', roles: [],
      authorization: {
        source: 'database' as const, accountStatus: 'active' as const,
        memberships: [{ branchId: 'school-a', status: 'active' as const }],
        assignments: [{
          roleDefinitionId: 'role',
          scope: scope === 'central' ? { kind: 'central' as const } : { kind: 'branch' as const, branchId: 'school-a' },
          permissions,
        }],
      },
    },
    scope: scope === 'central' ? { kind: 'central' as const } : { kind: 'branch' as const, branchId: 'school-a' },
    options: [], branches: [], permissions,
    entries: { studio: null, grading: '/grading', admin: null },
  };
}

function overviewFixture(overrides: Partial<GradingOverview> = {}): GradingOverview {
  return {
    generatedAt: '2026-09-25T12:00:00.000Z',
    statusCounts: { submitted: 7, in_review: 2, approved: 40, changes_requested: 3 },
    waiting: 9,
    examsAwaitingManual: 4,
    gradedLast7Days: 12,
    gradedPrior7Days: 9,
    oldest: [{
      id: 'submission-old', learnerName: 'Nguyễn Minh Anh', courseTitle: 'Tư duy thiết kế', itemTitle: 'Bài tập 1',
      status: 'submitted', submittedAt: '2026-09-21T09:00:00.000Z',
      href: '/grading/assignments/submission-old?branchId=school-a&back=%2Fgrading%2Fqueue%3Fstatus%3Dpending',
    }],
    throughput: [{ day: '2026-09-25', received: 3, released: 2 }],
    recent: [{
      id: 'grade-1', graderName: 'Trần Thu Hà', graderAvatarUrl: null, learnerName: 'Lê Văn Bình', itemTitle: 'Bài tập 2',
      released: true, decision: 'approved', gradedAt: '2026-09-25T10:00:00.000Z', href: '/grading/assignments/submission-2',
    }],
    ...overrides,
  };
}

function markup(page: ReactElement) {
  const provider = {
    locale: 'en', messages: staffUiTestMessages(en, 'en'), timeZone: 'UTC', now: new Date('2026-09-25T12:00:00.000Z'),
  } as Omit<ComponentProps<typeof NextIntlClientProvider>, 'children'> as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, provider, page));
}

describe('Assessment & grading overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue(overviewFixture());
  });

  it('lists only the destinations the active scope reaches', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));

    const html = markup(await GradingOverviewPage());

    expect(html).toContain('/grading/queue');
    expect(html).toContain('/grading/assessments');
    expect(html).not.toContain('/grading/reports');
  });

  it('shows a report-only operator reports alone', async () => {
    mocks.context.mockResolvedValue(context(['report.branch.read']));

    const html = markup(await GradingOverviewPage());

    expect(html).toContain('/grading/reports');
    expect(html).not.toContain('/grading/queue');
    expect(html).not.toContain('/grading/assessments');
    expect(html).not.toContain('Grade next');
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it('never offers a Studio or Administration destination', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade', 'exam.release', 'report.branch.read']));

    const html = markup(await GradingOverviewPage());

    expect(html).not.toContain('/studio');
    expect(html).not.toContain('/admin');
  });

  it('reads the overview in the grader\'s school and renders the grading dashboard', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));

    const html = markup(await GradingOverviewPage());

    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({
      scope: { global: false, branchIds: ['school-a'] }, locale: 'en',
    }));
    expect(html).toContain('Grade next');
    expect(html).toContain('href="/grading/assignments/submission-old?branchId=school-a&amp;back=%2Fgrading%2Fqueue%3Fstatus%3Dpending"');
    for (const label of ['Waiting to grade', 'Exam attempts to grade', 'Oldest waiting', 'Graded in 7 days']) expect(html).toContain(label);
    expect(html).toContain('>9</span>');
    expect(html).toContain('4 days');
    expect(html).toContain('data-slot="stat-delta" data-direction="up"');
    expect(html).toContain('vs previous 7 days');
    for (const status of ['submitted', 'in_review', 'approved', 'changes_requested']) {
      expect(html).toContain(`href="/grading/queue?status=${status}"`);
    }
    expect(html).toContain('Grading throughput, 30 days');
    expect(html).toContain('Oldest waiting submissions');
    expect(html).toContain('Nguyễn Minh Anh');
    expect(html).toContain('Recently graded');
    expect(html).toContain('Trần Thu Hà');
    expect(html).toContain('returned a grade for');
  });

  it('disables "Grade next" with a reason when nothing is waiting', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));
    mocks.overview.mockResolvedValue(overviewFixture({ oldest: [], waiting: 0 }));

    const html = markup(await GradingOverviewPage());

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="grade-next-reason"[^>]*>Grade next/);
    expect(html).toContain('Nothing is waiting to be graded.');
    expect(html).toContain('None waiting');
  });

  it('says Unavailable, never 0, for failed reads and drops the delta without a previous window', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));
    mocks.overview.mockResolvedValue(overviewFixture({
      statusCounts: null, waiting: null, examsAwaitingManual: null, gradedPrior7Days: null, oldest: null, throughput: null, recent: null,
    }));

    const html = markup(await GradingOverviewPage());

    expect(html).toContain('The grading queue could not be read.');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('data-slot="stat-delta"');
    // Waiting, exam attempts and oldest waiting cannot be read; only the 7-day count still can.
    expect(html.match(/data-slot="stat-card" data-state="unavailable"/g)).toHaveLength(3);
    expect(html).not.toContain('>0</span>');
  });
});

describe('learning reports page authorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a branch report reader and keeps its filters', async () => {
    mocks.context.mockResolvedValue(context(['report.branch.read']));

    const page = await LearningReportsPage({ searchParams: Promise.resolve({ from: '2026-09-01', branchId: 'school-a', nonsense: 'x' }) });

    expect(page.props.initialFilters).toEqual({ from: '2026-09-01', branchId: 'school-a' });
    expect(page.props.canGrade).toBe(false);
  });

  it('accepts the retained legacy analytics permission', async () => {
    mocks.context.mockResolvedValue(context(['analytics.branch.read']));

    await expect(LearningReportsPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it('requires a global report permission at Central scope', async () => {
    mocks.context.mockResolvedValue(context(['report.branch.read'], 'central'));

    await expect(LearningReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden:403');
  });

  it('refuses a grader who cannot read reports', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));

    await expect(LearningReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('forbidden:403');
  });
});

describe('grading workbench pages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens an assignment workbench with no exam release control', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));

    const page = await GradingAssignmentPage({ params: Promise.resolve({ id: 'submission-1' }) });

    expect(page.props).toMatchObject({
      kind: 'assignments', id: 'submission-1', scope: 'branch:school-a', locale: 'en', canRelease: false,
    });
  });

  it('opens an exam workbench and offers release only to a release holder', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade', 'exam.release']));
    const released = await GradingExamPage({ params: Promise.resolve({ id: 'attempt-1' }) });
    expect(released.props).toMatchObject({ kind: 'exams', id: 'attempt-1', canRelease: true });

    mocks.context.mockResolvedValue(context(['submission.grade']));
    const withheld = await GradingExamPage({ params: Promise.resolve({ id: 'attempt-1' }) });
    expect(withheld.props.canRelease).toBe(false);
  });

  it('passes the server-resolved titles and next link, read once with the URL filters and scope', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade']));
    mocks.workbench.mockResolvedValueOnce({
      titles: { course: 'Tư duy thiết kế', item: 'Bài tập 1' },
      nextHref: Promise.resolve('/grading/assignments/submission-2?branchId=school-a'),
    });
    const search = { branchId: 'school-a', back: '/grading/queue?status=pending' };

    const page = await GradingAssignmentPage({ params: Promise.resolve({ id: 'submission-1' }), searchParams: Promise.resolve(search) });

    expect(mocks.workbench).toHaveBeenCalledTimes(1);
    expect(mocks.workbench).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'assignments', id: 'submission-1', locale: 'en', search, scopeBranchId: 'school-a',
    }));
    expect(page.props).toMatchObject({ titles: { course: 'Tư duy thiết kế', item: 'Bài tập 1' } });
    // "Next in queue" is streamed: the page hands the workbench the pending promise, unawaited.
    await expect(page.props.nextHref).resolves.toBe('/grading/assignments/submission-2?branchId=school-a');
  });

  it('reads the exam workbench context for the attempt', async () => {
    mocks.context.mockResolvedValue(context(['submission.grade'], 'central'));
    const page = await GradingExamPage({ params: Promise.resolve({ id: 'attempt-1' }) });
    expect(mocks.workbench).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exams', id: 'attempt-1', scopeBranchId: null }));
    expect(page.props.titles).toBeNull();
    await expect(page.props.nextHref).resolves.toBeNull();
  });
});

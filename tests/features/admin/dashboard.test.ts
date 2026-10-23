import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  managementRead: vi.fn(),
  loadStudioLearningReport: vi.fn(),
  schoolReports: vi.fn(),
  actorDisplayNames: vi.fn(),
  database: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => mocks.database }));
vi.mock('@/features/admin/management', () => ({ managementRead: mocks.managementRead }));
vi.mock('@/features/reporting/service', () => ({ loadStudioLearningReport: mocks.loadStudioLearningReport }));
vi.mock('@/features/admin/school-reports', () => ({ schoolReports: mocks.schoolReports }));
vi.mock('@/features/admin/actor-directory', () => ({ actorDisplayNames: mocks.actorDisplayNames }));
// Grants are listed per scope kind so central-only permissions can be tested in a school scope.
vi.mock('@/lib/permissions', () => ({
  can: (actor: { grants: Record<string, string[]> }, permission: string, scope: { kind: string }) =>
    (actor.grants[scope.kind] ?? []).includes(permission),
}));

import {
  activeLearnerWindows,
  adminDashboard,
  rankSchools,
  reportCalendarDay,
  sumActivityByDay,
  utcDayRange,
} from '@/features/admin/dashboard';
import { buildAdminOverviewView } from '@/features/admin/ui/overview/view-model';

type Call = [string, ...unknown[]];
type Response = { data?: unknown; count?: number | null; error?: unknown };
type Handler = (table: string, calls: Call[]) => Response;

/** A chainable PostgREST stand-in: records every builder call and resolves through `handler`. */
function fakeDatabase(handler: Handler) {
  const log: { table: string; calls: Call[] }[] = [];
  return {
    log,
    from(table: string) {
      const calls: Call[] = [];
      log.push({ table, calls });
      const builder: object = new Proxy({}, {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (value: Response) => void, reject: (error: unknown) => void) =>
              Promise.resolve().then(() => handler(table, calls)).then(resolve, reject);
          }
          return (...args: unknown[]) => { calls.push([prop, ...args]); return builder; };
        },
      });
      return builder;
    },
  };
}

const NOW = new Date('2026-09-25T03:00:00.000Z');
const ALL_CENTRAL = [
  'member.read', 'branch.read', 'learning.read', 'grading.read', 'audit.read',
  'content.review', 'content.read', 'membership.manage', 'report.global.read',
];
const ENTRIES = { studio: '/studio', grading: '/grading', admin: '/admin' };

function context(grants: { central?: string[]; branch?: string[] }, scope: { kind: 'central' } | { kind: 'branch'; branchId: string } = { kind: 'central' }) {
  return {
    workspace: 'admin',
    actor: { userId: '00000000-0000-4000-8000-000000000001', roles: [], grants },
    scope,
    options: [],
    branches: [],
    permissions: [...(grants[scope.kind] ?? [])],
    entries: ENTRIES,
  } as never;
}

function report(activeUsers: number) {
  return { overview: { activeUsers } };
}

function defaultHandler(overrides: Partial<Record<string, Handler>> = {}): Handler {
  return (table, calls) => {
    const override = overrides[table];
    if (override) return override(table, calls);
    if (table === 'analytics_branch_daily' || table === 'cms_review_requests') return { data: [], error: null };
    return { count: 0, error: null };
  };
}

function request(type: string, id: string, status: string, day: number) {
  return { content_type: type, content_id: id, status, submitted_at: `2026-09-${String(day).padStart(2, '0')}T08:00:00.000Z` };
}

/** Answers both review reads: open-status candidates, then the history of those items. */
function reviewHandler(rows: ReturnType<typeof request>[]): Handler {
  return (_table, calls) => {
    const statusFilter = calls.find(([method, column]) => method === 'in' && column === 'status')?.[2] as string[] | undefined;
    if (statusFilter) return { data: rows.filter((row) => statusFilter.includes(row.status)), error: null };
    const type = eqValue(calls, 'content_type');
    const ids = calls.find(([method, column]) => method === 'in' && column === 'content_id')?.[2] as string[];
    return { data: rows.filter((row) => row.content_type === type && ids.includes(row.content_id)), error: null };
  };
}

function eqValue(calls: Call[], column: string) {
  return calls.find(([method, key]) => method === 'eq' && key === column)?.[2];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.database = fakeDatabase(defaultHandler());
  mocks.managementRead.mockResolvedValue({ members: 40, schools: 3, enrollments: 90, pendingGrading: 7, recentActivity: [] });
  mocks.loadStudioLearningReport.mockImplementation(async (_actor, _scope, query: { from: string }) =>
    report(query.from === '2026-08-27' ? 120 : 100));
  mocks.schoolReports.mockResolvedValue([]);
  mocks.actorDisplayNames.mockResolvedValue(new Map());
});

describe('date windows', () => {
  it('uses the learning report calendar day and two back-to-back 30-day windows', () => {
    expect(reportCalendarDay(new Date('2026-09-24T18:30:00.000Z'))).toBe('2026-09-25');
    expect(activeLearnerWindows('2026-09-25')).toEqual({
      period: { from: '2026-08-27', to: '2026-09-25' },
      previousPeriod: { from: '2026-07-28', to: '2026-08-26' },
    });
  });

  it('lists the last 30 UTC days oldest first', () => {
    const days = utcDayRange(NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-08-27');
    expect(days.at(-1)).toBe('2026-09-25');
    expect(new Set(days).size).toBe(30);
  });
});

describe('active learners delta', () => {
  it('compares today−29..today with today−59..today−30 from the learning report', async () => {
    const data = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });

    expect(mocks.loadStudioLearningReport).toHaveBeenCalledTimes(2);
    expect(mocks.loadStudioLearningReport).toHaveBeenCalledWith(expect.anything(), { kind: 'central' }, { from: '2026-08-27', to: '2026-09-25' });
    expect(mocks.loadStudioLearningReport).toHaveBeenCalledWith(expect.anything(), { kind: 'central' }, { from: '2026-07-28', to: '2026-08-26' });
    expect(data.activeLearners).toEqual({
      current: 120,
      previous: 100,
      period: { from: '2026-08-27', to: '2026-09-25' },
      previousPeriod: { from: '2026-07-28', to: '2026-08-26' },
    });
    const view = buildAdminOverviewView({ data, permissions: ALL_CENTRAL as never, entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.kpis.find((kpi) => kpi.key === 'activeLearners')).toMatchObject({ value: 120, delta: 20 });
  });

  it('keeps the value but drops the delta when the previous window cannot be read', async () => {
    mocks.loadStudioLearningReport.mockImplementation(async (_actor, _scope, query: { from: string }) => {
      if (query.from === '2026-08-27') return report(120);
      throw new ApiError(500, 'REPORT_DATABASE_ERROR', 'Unable to load learning report');
    });
    const data = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });

    expect(data.activeLearners?.previous).toBeNull();
    expect(data.unavailable ?? []).not.toContain('activeLearners');
    const view = buildAdminOverviewView({ data, permissions: ALL_CENTRAL as never, entries: ENTRIES, locale: 'en', title: 'Overview' });
    const card = view.kpis.find((kpi) => kpi.key === 'activeLearners');
    expect(card).toMatchObject({ value: 120 });
    expect(card).not.toHaveProperty('delta');
  });

  it('shows a flat delta (0) when both windows match, because 0 is a real previous value', () => {
    const view = buildAdminOverviewView({
      data: { activeLearners: { current: 5, previous: 5, period: { from: 'a', to: 'b' }, previousPeriod: { from: 'c', to: 'd' } } },
      permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview',
    });
    expect(view.kpis[0]).toMatchObject({ key: 'activeLearners', value: 5, delta: 0 });
  });

  it('never gives snapshot counts a delta', () => {
    const view = buildAdminOverviewView({
      data: { members: 4, pendingGrading: 3, pendingReview: 2, schools: 1, enrollments: 9, publishedContent: 8 },
      permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview',
    });
    for (const kpi of view.kpis) expect(kpi).not.toHaveProperty('delta');
  });

  it('marks the card unavailable when the current window fails, and hides it on a permission error', async () => {
    mocks.loadStudioLearningReport.mockRejectedValue(new ApiError(500, 'REPORT_DATABASE_ERROR', 'Unable to load learning report'));
    const failed = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(failed.activeLearners).toBeUndefined();
    expect(failed.unavailable).toContain('activeLearners');
    const view = buildAdminOverviewView({ data: failed, permissions: ALL_CENTRAL as never, entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.kpis.find((kpi) => kpi.key === 'activeLearners')).toEqual({ key: 'activeLearners', value: null });

    mocks.loadStudioLearningReport.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const denied = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(denied.activeLearners).toBeUndefined();
    expect(denied.unavailable ?? []).not.toContain('activeLearners');
  });
});

describe('learning activity series', () => {
  it('sums schools per UTC day, only additive metrics, zero-filling missing days', () => {
    const days = utcDayRange(NOW);
    const series = sumActivityByDay([
      { branch_id: 'ans', day: '2026-09-25', lesson_completions: 3, quiz_attempts: 2, exam_attempts: '1', active_learners_30d: 99 },
      { branch_id: 'dewey', day: '2026-09-25', lesson_completions: '4', quiz_attempts: 0, exam_attempts: 5 },
      { branch_id: 'ans', day: '2026-08-27', lesson_completions: 1, quiz_attempts: 0, exam_attempts: 0 },
      { branch_id: 'ans', day: '2026-08-01', lesson_completions: 50, quiz_attempts: 50, exam_attempts: 50 },
    ], days);

    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ day: '2026-08-27', lessonCompletions: 1, attempts: 0 });
    expect(series.at(-1)).toEqual({ day: '2026-09-25', lessonCompletions: 7, attempts: 8 });
    expect(series.slice(1, -1).every((day) => day.lessonCompletions === 0 && day.attempts === 0)).toBe(true);
    expect(series).not.toContainEqual(expect.objectContaining({ day: '2026-08-01' }));
  });

  it('rejects malformed counts instead of charting them as zero', () => {
    expect(() => sumActivityByDay([{ day: '2026-09-25', lesson_completions: 'x', quiz_attempts: 0, exam_attempts: 0 }], ['2026-09-25'])).toThrow();
  });

  it('reads analytics_branch_daily for the 30-day UTC window, paging past 1000 rows, filtered to the school in school scope', async () => {
    const first = Array.from({ length: 1000 }, () => ({ day: '2026-09-24', lesson_completions: 1, quiz_attempts: 0, exam_attempts: 0 }));
    let page = 0;
    const database = fakeDatabase(defaultHandler({
      analytics_branch_daily: () => ({ data: page++ === 0 ? first : [{ day: '2026-09-24', lesson_completions: 1, quiz_attempts: 1, exam_attempts: 1 }], error: null }),
    }));
    mocks.database = database;
    const data = await adminDashboard(context({ branch: ['report.branch.read'] }, { kind: 'branch', branchId: 'ans' }), { now: NOW });

    const reads = database.log.filter((entry) => entry.table === 'analytics_branch_daily');
    expect(reads).toHaveLength(2);
    expect(reads[0].calls).toContainEqual(['gte', 'day', '2026-08-27']);
    expect(reads[0].calls).toContainEqual(['lte', 'day', '2026-09-25']);
    expect(eqValue(reads[0].calls, 'branch_id')).toBe('ans');
    expect(reads[0].calls).toContainEqual(['range', 0, 999]);
    expect(reads[1].calls).toContainEqual(['range', 1000, 1999]);
    expect(data.activitySeries?.find((day) => day.day === '2026-09-24')).toEqual({ day: '2026-09-24', lessonCompletions: 1001, attempts: 2 });
  });

  it('says unavailable when the daily read fails, and hides the chart without report permission', async () => {
    mocks.database = fakeDatabase(defaultHandler({ analytics_branch_daily: () => ({ data: null, error: { message: 'boom' } }) }));
    const failed = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(failed.activitySeries).toBeUndefined();
    expect(failed.unavailable).toContain('activitySeries');
    expect(buildAdminOverviewView({ data: failed, permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview' }).activity).toEqual({ state: 'unavailable' });

    mocks.loadStudioLearningReport.mockClear();
    const database = fakeDatabase(defaultHandler());
    mocks.database = database;
    const hidden = await adminDashboard(context({ central: ['member.read'] }), { now: NOW });
    expect(hidden.activitySeries).toBeUndefined();
    expect(hidden.activeLearners).toBeUndefined();
    expect(hidden.unavailable).toBeUndefined();
    expect(mocks.loadStudioLearningReport).not.toHaveBeenCalled();
    expect(database.log.some((entry) => entry.table === 'analytics_branch_daily')).toBe(false);
    expect(buildAdminOverviewView({ data: hidden, permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview' }).activity).toBeUndefined();
  });
});

describe('permission gating', () => {
  it('counts pending invitations only with membership.manage, using the pending definition', async () => {
    const database = fakeDatabase(defaultHandler({ admin_invitations: () => ({ count: 4, error: null }) }));
    mocks.database = database;
    const data = await adminDashboard(context({ branch: ['member.read', 'membership.manage'] }, { kind: 'branch', branchId: 'ans' }), { now: NOW });

    expect(data.pendingInvitations).toBe(4);
    const read = database.log.find((entry) => entry.table === 'admin_invitations')!;
    expect(read.calls).toContainEqual(['is', 'accepted_at', null]);
    expect(read.calls).toContainEqual(['is', 'revoked_at', null]);
    expect(read.calls).toContainEqual(['gt', 'expires_at', NOW.toISOString()]);
    expect(eqValue(read.calls, 'branch_id')).toBe('ans');

    const withoutManage = fakeDatabase(defaultHandler());
    mocks.database = withoutManage;
    const hidden = await adminDashboard(context({ central: ['member.read'] }), { now: NOW });
    expect(hidden.pendingInvitations).toBeUndefined();
    expect(withoutManage.log.some((entry) => entry.table === 'admin_invitations')).toBe(false);
    const view = buildAdminOverviewView({ data: hidden, permissions: ['member.read'], entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.kpis[0]).not.toHaveProperty('pendingInvitations');
    expect(view.inviteHref).toBeUndefined();
  });

  it('offers "Invite member" only with membership.manage and member.read', () => {
    const base = { data: {}, entries: ENTRIES, locale: 'en', title: 'Overview' };
    expect(buildAdminOverviewView({ ...base, permissions: ['membership.manage', 'member.read'] }).inviteHref).toBe('/admin/users?invite=1');
    // /admin/users needs member.read, so the button would lead to a forbidden page.
    expect(buildAdminOverviewView({ ...base, permissions: ['membership.manage'] }).inviteHref).toBeUndefined();
    expect(buildAdminOverviewView({ ...base, permissions: ['member.manage', 'admin.access'] }).inviteHref).toBeUndefined();
  });

  it('builds the review pipeline only for content.review in the central scope', async () => {
    const history = [
      ...Array.from({ length: 5 }, (_, index) => request('course', `p${index}`, 'pending', 1)),
      ...Array.from({ length: 2 }, (_, index) => request('resource', `c${index}`, 'changes_requested', 1)),
      request('project', 'a0', 'approved', 1),
    ];
    mocks.database = fakeDatabase(defaultHandler({ cms_review_requests: reviewHandler(history) }));
    const central = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(central.pendingReview).toBe(5);
    expect(central.reviewPipeline).toEqual({ pending: 5, changesRequested: 2, approved: 1 });
    const view = buildAdminOverviewView({ data: central, permissions: ALL_CENTRAL as never, entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.pipeline?.map((stage) => [stage.key, stage.count, stage.href])).toEqual([
      ['pending', 5, '/studio/reviews'],
      ['changesRequested', 2, undefined],
      ['approved', 1, undefined],
      ['pendingGrading', 7, '/grading/queue?status=pending'],
    ]);

    const database = fakeDatabase(defaultHandler());
    mocks.database = database;
    const branch = await adminDashboard(context({ central: ['content.review'], branch: ['content.review'] }, { kind: 'branch', branchId: 'ans' }), { now: NOW });
    expect(branch.reviewPipeline).toBeUndefined();
    expect(branch.pendingReview).toBeUndefined();
    expect(database.log.some((entry) => entry.table === 'cms_review_requests')).toBe(false);
  });

  it('ranks the top five schools centrally and hides the card without the report permission or in a school scope', async () => {
    mocks.schoolReports.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({
      branchId: id, name: `School ${id}`, enrollments: 0, completedEnrollments: 0, submissions: 0, pendingGrading: 0, averagePercent: null, activeLearners30d: index,
    })));
    const central = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(central.schoolRanking?.map((row) => row.branchId)).toEqual(['f', 'e', 'd', 'c', 'b']);
    expect(central.schoolRanking?.[0]).toEqual({ branchId: 'f', name: 'School f', activeLearners30d: 5 });

    mocks.schoolReports.mockResolvedValue(undefined);
    const denied = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(denied.schoolRanking).toBeUndefined();
    expect(denied.unavailable ?? []).not.toContain('schoolRanking');

    mocks.schoolReports.mockClear();
    await adminDashboard(context({ branch: ['report.branch.read'] }, { kind: 'branch', branchId: 'ans' }), { now: NOW });
    expect(mocks.schoolReports).not.toHaveBeenCalled();
  });

  it('breaks ranking ties by name', () => {
    expect(rankSchools([
      { branchId: 'b', name: 'Bến Tre', activeLearners30d: 2 },
      { branchId: 'a', name: 'An Giang', activeLearners30d: 2 },
      { branchId: 'c', name: 'Cà Mau', activeLearners30d: 3 },
    ]).map((row) => row.branchId)).toEqual(['c', 'a', 'b']);
  });

  it('tops up the KPI row from the fallbacks when primary cards are hidden', () => {
    const view = buildAdminOverviewView({
      data: { members: 3, schools: 2, enrollments: 10, publishedContent: 4 },
      permissions: ['member.read', 'branch.read'], entries: { studio: null, grading: null, admin: '/admin' }, locale: 'en', title: 'Overview',
    });
    expect(view.kpis.map((kpi) => kpi.key)).toEqual(['members', 'schools', 'enrollments', 'publishedContent']);
    expect(view.kpis.map((kpi) => kpi.href)).toEqual(['/admin/users', '/admin/branches', undefined, undefined]);
  });

  it('links waiting counts to other workspaces only when the actor can enter them', () => {
    const data = { pendingGrading: 3, pendingReview: 2 };
    const linked = buildAdminOverviewView({ data, permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(linked.kpis.map((kpi) => kpi.href)).toEqual(['/grading/queue?status=pending', '/studio/reviews']);
    const unlinked = buildAdminOverviewView({ data, permissions: [], entries: { studio: null, grading: null, admin: '/admin' }, locale: 'en', title: 'Overview' });
    expect(unlinked.kpis.map((kpi) => kpi.href)).toEqual([undefined, undefined]);
  });
});

describe('failed reads say Unavailable, never 0', () => {
  it('marks the permitted dashboard-operation cards unavailable when the operation fails', async () => {
    mocks.managementRead.mockRejectedValue(new Error('Unable to complete administration request'));
    const data = await adminDashboard(context({ central: ['admin.access', 'member.read', 'grading.read', 'audit.read'] }), { now: NOW });

    expect(data.members).toBeUndefined();
    expect(data.unavailable).toEqual(expect.arrayContaining(['members', 'pendingGrading', 'recentActivity']));
    expect(data.unavailable).not.toContain('schools');
    expect(data.unavailable).not.toContain('enrollments');
    const view = buildAdminOverviewView({ data, permissions: ['member.read', 'audit.read'], entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.kpis.map((kpi) => [kpi.key, kpi.value])).toEqual([['members', null], ['pendingGrading', null]]);
    expect(view.recent).toEqual({ state: 'unavailable' });
    expect(view.auditHref).toBe('/admin/audit');
  });

  it('counts each item once, by its latest review request', async () => {
    const history = [
      // Sent back, resubmitted, approved and published: the old decision no longer counts.
      request('course', 'published', 'changes_requested', 1),
      request('course', 'published', 'published', 3),
      // Sent back twice, still waiting on the author: counts once.
      request('resource', 'twice', 'changes_requested', 2),
      request('resource', 'twice', 'changes_requested', 4),
      // Sent back, then resubmitted: now in review.
      request('project', 'again', 'changes_requested', 2),
      request('project', 'again', 'pending', 5),
      // Same id, other type: a separate item.
      request('resource', 'published', 'approved', 6),
    ];
    mocks.database = fakeDatabase(defaultHandler({ cms_review_requests: reviewHandler(history) }));
    const data = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(data.reviewPipeline).toEqual({ pending: 1, changesRequested: 1, approved: 1 });
    expect(data.pendingReview).toBe(1);
  });

  it('keeps the rest of the overview when one count fails', async () => {
    mocks.database = fakeDatabase(defaultHandler({
      bank_questions: () => ({ count: null, error: { message: 'boom' } }),
      admin_invitations: () => ({ count: null, error: { message: 'boom' } }),
      cms_review_requests: () => ({ count: null, error: { message: 'boom' } }),
    }));
    const data = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });

    expect(data.members).toBe(40);
    expect(data.publishedContent).toBeUndefined();
    expect(data.pendingInvitations).toBeUndefined();
    expect(data.unavailable).toEqual(expect.arrayContaining(['publishedContent', 'pendingInvitations', 'pendingReview', 'reviewPipeline']));
    const view = buildAdminOverviewView({ data, permissions: ALL_CENTRAL as never, entries: ENTRIES, locale: 'en', title: 'Overview' });
    expect(view.kpis.find((kpi) => kpi.key === 'members')).toMatchObject({ value: 40, pendingInvitations: null });
    expect(view.kpis.find((kpi) => kpi.key === 'pendingReview')).toMatchObject({ value: null });
    expect(view.pipeline?.slice(0, 3).map((stage) => stage.count)).toEqual([null, null, null]);
  });

  it('reports a school ranking failure as unavailable', async () => {
    mocks.schoolReports.mockRejectedValue(new Error('Unable to load school reports'));
    const data = await adminDashboard(context({ central: ALL_CENTRAL }), { now: NOW });
    expect(data.unavailable).toContain('schoolRanking');
    expect(buildAdminOverviewView({ data, permissions: [], entries: ENTRIES, locale: 'en', title: 'Overview' }).schools).toEqual({ state: 'unavailable' });
  });
});

describe('recent activity', () => {
  it('resolves actor names and formats actions and targets for the locale', async () => {
    const actorId = '11111111-1111-4111-8111-111111111111';
    mocks.managementRead.mockResolvedValue({
      recentActivity: [
        { id: '1', action: 'invitation.revoke', actorId, targetType: 'invitation', targetId: 'invite-1', at: '2026-09-24T00:00:00.000Z' },
        { id: '2', action: 'user.role', actorId: null, targetType: 'user', targetId: 'u-1', at: '2026-09-23T00:00:00.000Z' },
        { id: '3', action: 'branch.update', actorId: '22222222-2222-4222-8222-222222222222', targetType: 'branch', targetId: 'ans', at: '2026-09-22T00:00:00.000Z' },
      ],
    });
    mocks.actorDisplayNames.mockResolvedValue(new Map([
      [actorId, { name: 'Nguyễn Minh Anh', avatarUrl: null, initials: 'MA' }],
      ['u-1', { name: 'Lê Thu Hà', avatarUrl: null, initials: 'TH' }],
    ]));
    const data = await adminDashboard(context({ central: ['audit.read'] }), { now: NOW });

    // Member targets are looked up with the actors, in one read.
    expect(mocks.actorDisplayNames).toHaveBeenCalledWith([actorId, null, '22222222-2222-4222-8222-222222222222', 'u-1']);
    expect(data.actors).toEqual({ [actorId]: { name: 'Nguyễn Minh Anh', avatarUrl: null }, 'u-1': { name: 'Lê Thu Hà', avatarUrl: null } });
    const view = buildAdminOverviewView({ data, permissions: ['audit.read', 'member.read'], entries: ENTRIES, locale: 'vi', title: 'Tổng quan' });
    expect(view.recent).toEqual({
      state: 'ready',
      items: [
        // The verb follows the actor's name in lower case; a type word that repeats it is dropped.
        { id: '1', actor: { kind: 'person', name: 'Nguyễn Minh Anh', avatarUrl: null }, action: 'đã thu hồi lời mời', href: undefined, at: '2026-09-24T00:00:00.000Z' },
        // A member target is named instead of "Thành viên".
        { id: '2', actor: { kind: 'system' }, action: 'đã thay đổi vai trò', target: 'Lê Thu Hà', href: '/admin/users/u-1', at: '2026-09-23T00:00:00.000Z' },
        { id: '3', actor: { kind: 'unknown' }, action: 'đã cập nhật trường', href: undefined, at: '2026-09-22T00:00:00.000Z' },
      ],
    });
  });

  it('skips the actor lookup when there is no activity', async () => {
    await adminDashboard(context({ central: ['audit.read'] }), { now: NOW });
    expect(mocks.actorDisplayNames).not.toHaveBeenCalled();
  });
});

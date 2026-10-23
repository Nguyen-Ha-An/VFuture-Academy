import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatStaffAuditAction, formatStaffAuditTarget } from '@/features/admin/audit-format';
import type { Branch } from '@/features/admin/branches';
import { BranchesManager, type SchoolReportCells } from '@/features/admin/components/BranchesManager';
import type { AdminOverviewData } from '@/features/admin/dashboard';
import type { AdminAuditEntry } from '@/features/admin/management-contracts';
import { AdminOverviewView } from '@/features/admin/ui/AdminOverviewView';
import { buildAdminOverviewView } from '@/features/admin/ui/overview/view-model';
import { AuditView, type AuditViewRow } from '@/app/admin/audit/AuditView';
import { SchoolDetailView, type SchoolDetailStat } from '@/app/admin/branches/SchoolDetailView';
import type { Permission } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import type { WorkspaceEntries } from '@/lib/workspace-navigation';

/**
 * Browser-harness-only fixtures for the Catmin admin page views (overview, schools, school detail,
 * audit). Labels come from the same message keys the server pages read; data is plain fixtures.
 */

/** Relative to the real clock, so feeds read "x hours ago" whenever the harness runs. */
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW - offset).toISOString();
const utcDay = (daysAgo: number) => iso(daysAgo * DAY).slice(0, 10);

const PEOPLE: Array<[string, string]> = [
  ['00000000-0000-4000-8000-000000000101', 'Nguyễn Minh Anh'],
  ['00000000-0000-4000-8000-000000000102', 'Trần Gia Bảo'],
  ['00000000-0000-4000-8000-000000000103', 'Lê Thu Hà'],
  ['00000000-0000-4000-8000-000000000106', 'Phạm Quốc Huy'],
  ['00000000-0000-4000-8000-000000000107', 'Hoàng Ngọc Diệp'],
];

export const SCHOOLS: Branch[] = [
  { id: 'ans', name: 'ANS · Hà Nội', city: 'Hà Nội', createdAt: '2025-08-01T00:00:00Z' },
  { id: 'dewey', name: 'Dewey · Cầu Giấy', city: 'Hà Nội', createdAt: '2025-09-12T00:00:00Z' },
  { id: 'lqd', name: 'Lê Quý Đôn · Đà Nẵng', city: 'Đà Nẵng', createdAt: '2025-10-03T00:00:00Z' },
  { id: 'ntmk', name: 'Nguyễn Thị Minh Khai · TP.HCM', city: 'TP. Hồ Chí Minh', createdAt: '2026-01-15T00:00:00Z' },
  { id: 'hue', name: 'Quốc Học · Huế', city: 'Huế', createdAt: '2026-03-02T00:00:00Z' },
  { id: 'can-tho', name: 'Châu Văn Liêm · Cần Thơ', city: null, createdAt: '2026-06-20T00:00:00Z' },
];

export const SCHOOL_REPORTS: Record<string, SchoolReportCells> = {
  ans: { activeLearners30d: 214, enrollments: 980, completedEnrollments: 612, completionPercent: 62.4, pendingGrading: 18, averagePercent: 78.2 },
  dewey: { activeLearners30d: 176, enrollments: 745, completedEnrollments: 401, completionPercent: 53.8, pendingGrading: 11, averagePercent: 74.9 },
  lqd: { activeLearners30d: 158, enrollments: 690, completedEnrollments: 452, completionPercent: 65.5, pendingGrading: 9, averagePercent: 81.3 },
  ntmk: { activeLearners30d: 141, enrollments: 820, completedEnrollments: 377, completionPercent: 46, pendingGrading: 16, averagePercent: 70.1 },
  hue: { activeLearners30d: 82, enrollments: 410, completedEnrollments: 198, completionPercent: 48.3, pendingGrading: 8, averagePercent: 76.4 },
  'can-tho': { activeLearners30d: 0, enrollments: 0, completedEnrollments: 0, completionPercent: null, pendingGrading: 0, averagePercent: null },
};

const ACTIVITY: Array<[string, string, string | null]> = [
  ['invitation.create', 'invitation', PEOPLE[0]![0]],
  ['user.role.set', 'user', PEOPLE[1]![0]],
  ['branch.update', 'branch', PEOPLE[0]![0]],
  ['content.review.approve', 'resource', PEOPLE[2]![0]],
  ['invitation.revoke', 'invitation', PEOPLE[3]![0]],
  ['user.account-status', 'user', null],
  ['role.create', 'role', PEOPLE[4]![0]],
  ['course.publish', 'course', PEOPLE[2]![0]],
];

function auditEntries(count: number): AdminAuditEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const [action, targetType, actorId] = ACTIVITY[index % ACTIVITY.length]!;
    const targetId = targetType === 'user' ? PEOPLE[(index + 1) % PEOPLE.length]![0] : targetType === 'branch' ? SCHOOLS[index % SCHOOLS.length]!.id : `${targetType}-${index + 1}`;
    return { id: `audit-${index + 1}`, action, actorId, targetType, targetId, at: iso(index * 97 * 60_000 + 20 * 60_000) };
  });
}

export const OVERVIEW_DATA: AdminOverviewData = {
  members: 1284,
  schools: SCHOOLS.length,
  enrollments: 3645,
  pendingGrading: 62,
  pendingReview: 6,
  publishedContent: 76,
  pendingInvitations: 3,
  activeLearners: {
    current: 771,
    previous: 702,
    period: { from: utcDay(29), to: utcDay(0) },
    previousPeriod: { from: utcDay(59), to: utcDay(30) },
  },
  activitySeries: Array.from({ length: 30 }, (_, index) => ({
    day: utcDay(29 - index),
    lessonCompletions: [42, 58, 61, 55, 70, 24, 12][index % 7]! + index,
    attempts: [18, 26, 30, 22, 35, 9, 4][index % 7]! + Math.round(index / 2),
  })),
  schoolRanking: SCHOOLS.slice(0, 5).map((school) => ({ branchId: school.id, name: school.name, activeLearners30d: SCHOOL_REPORTS[school.id]!.activeLearners30d })),
  reviewPipeline: { pending: 6, changesRequested: 3, approved: 2 },
  recentActivity: auditEntries(8),
  actors: Object.fromEntries(PEOPLE.map(([id, name]) => [id, { name, avatarUrl: null }])),
};

export function AdminOverviewFixture({ permissions, entries, central }: { permissions: Permission[]; entries: WorkspaceEntries; central: boolean }) {
  const t = useTranslations('centralAdmin');
  const locale = useLocale();
  return <AdminOverviewView {...buildAdminOverviewView({
    data: central ? OVERVIEW_DATA : { ...OVERVIEW_DATA, schools: undefined, schoolRanking: undefined, reviewPipeline: undefined, pendingReview: undefined, publishedContent: undefined },
    permissions,
    entries,
    locale,
    eyebrow: central ? t('central') : SCHOOLS[0]!.name,
    title: t('overview'),
    description: t('overviewDescription'),
  })} />;
}

export function BranchesFixture({ canManage }: { canManage: boolean }) {
  return <BranchesManager initialBranches={SCHOOLS} reports={SCHOOL_REPORTS} canManage={canManage} />;
}

const MEMBER_NAMES = ['Nguyễn Minh Anh', 'Trần Gia Bảo', 'Lê Thu Hà', 'Phạm Quốc Huy', 'Hoàng Ngọc Diệp', 'Vũ Đức Thắng', 'Đặng Thảo Vy', 'Bùi Khánh Linh', 'Đỗ Hải Nam', 'Ngô Phương Thảo'];

export function SchoolDetailFixture({ branchId }: { branchId: string }) {
  const t = useTranslations('centralAdmin');
  const to = useTranslations('staffUi.admin.org.schoolDetail');
  const format = useFormatter();
  const school = SCHOOLS.find((entry) => entry.id === branchId) ?? SCHOOLS[0]!;
  const params = new URLSearchParams(location.search);
  const tab = ['members', 'staff', 'cms'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'overview';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const cells = SCHOOL_REPORTS[school.id]!;
  const percent = (value: number | null) => (value === null ? '—' : format.number(value / 100, { style: 'percent', maximumFractionDigits: 1 }));
  const stats: SchoolDetailStat[] = [
    { key: 'members', label: to('stats.members'), value: 312 },
    { key: 'enrollments', label: to('stats.enrollments'), value: cells.enrollments },
    { key: 'pendingGrading', label: to('stats.pendingGrading'), value: cells.pendingGrading },
    { key: 'activeLearners', label: to('stats.activeLearners'), value: cells.activeLearners30d },
    { key: 'completion', label: to('stats.completion'), value: percent(cells.completionPercent), hint: to('stats.completedHint', { completed: cells.completedEnrollments, total: cells.enrollments }) },
    { key: 'averageScore', label: to('stats.averageScore'), value: percent(cells.averagePercent) },
  ];
  const tabHref = (key: string, query: Record<string, string> = {}) => routes.admin.branch(school.id, { tab: key === 'overview' ? undefined : key, ...query });
  const hasMore = page < 3;
  const rows = MEMBER_NAMES.map((name, index) => ({
    id: `member-${page}-${index}`,
    name: page > 1 ? `${name} ${page}` : name,
    email: `hoc.vien${(page - 1) * 10 + index + 1}@example.test`,
    href: routes.admin.user(`member-${page}-${index}`),
    roles: tab === 'staff' ? (index % 2 ? 'Giáo viên' : 'Quản trị trường') : 'Học viên',
    status: index === 6 ? ('suspended' as const) : ('active' as const),
  }));
  return <SchoolDetailView
    school={{ id: school.id, name: school.name, description: school.city ? `${t('schools')} · ${school.city}` : t('schools') }}
    tabs={[
      ...['overview', 'members', 'staff', 'cms'].map((key) => ({ key, label: t(key), href: tabHref(key), current: key === tab })),
      { key: 'reports', label: t('reports'), href: routes.grading.reports({ branchId: school.id }), current: false, external: true },
    ]}
    tabsLabel={to('sections')}
    enter={{ action: () => {}, scope: `branch:${school.id}`, destination: '/admin', label: t('enterSchool') }}
    stats={tab === 'overview' ? stats : undefined}
    unavailableLabel={to('unavailable')}
    members={tab === 'members' || tab === 'staff' ? {
      title: tab === 'staff' ? to('staffTitle') : to('membersTitle'),
      rows,
      page,
      hasMore,
      previousHref: page > 1 ? tabHref(tab, page - 1 > 1 ? { page: String(page - 1) } : {}) : null,
      nextHref: hasMore ? tabHref(tab, { page: String(page + 1) }) : null,
      labels: { member: to('columns.member'), roles: to('columns.roles'), status: to('columns.status'), empty: tab === 'staff' ? to('emptyStaff') : to('emptyMembers'), unavailable: to('membersUnavailable'), pagination: to('pagination') },
    } : undefined}
    note={tab === 'cms' ? to('cmsDescription') : undefined}
  />;
}

const AUDIT_FAMILIES = ['branch', 'content', 'course', 'invitation', 'profile', 'project', 'role', 'submission', 'user'] as const;
const AUDIT_PAGE = 50;
const AUDIT_ROWS = auditEntries(118);

export function AuditFixture() {
  const t = useTranslations('centralAdmin');
  const to = useTranslations('staffUi.admin.org.audit');
  const locale = useLocale();
  const params = new URLSearchParams(location.search);
  const filters = { actor: params.get('actor') ?? undefined, action: params.get('action') ?? undefined, target: params.get('target') ?? undefined };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const matching = AUDIT_ROWS.filter((row) => (!filters.actor || row.actorId === filters.actor)
    && (!filters.action || row.action.includes(filters.action))
    && (!filters.target || row.targetId.includes(filters.target)));
  const slice = matching.slice((page - 1) * AUDIT_PAGE, page * AUDIT_PAGE);
  const hasMore = matching.length > page * AUDIT_PAGE;
  const filtered = Boolean(filters.actor || filters.action || filters.target);
  const actorName = (id: string) => PEOPLE.find(([personId]) => personId === id)?.[1];
  const auditHref = (next: typeof filters, nextPage = 1) => routes.admin.audit({ ...next, page: nextPage > 1 ? nextPage : undefined });
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
  const rows: AuditViewRow[] = slice.map((row) => {
    const name = row.actorId ? actorName(row.actorId) : undefined;
    return {
      id: row.id,
      at: row.at,
      time: time.format(new Date(row.at)),
      action: formatStaffAuditAction(row.action, locale),
      actor: row.actorId ? { name: name ?? row.actorId, isId: !name, href: auditHref({ ...filters, actor: row.actorId }), filterLabel: to('filterByActor', { name: name ?? to('unknownActor') }) } : null,
      target: { label: formatStaffAuditTarget(row.targetType, locale), id: row.targetId },
    };
  });
  return <AuditView
    title={t('history')}
    description={t('auditScopeHint')}
    filters={{ action: filters.action ?? '', target: filters.target ?? '', actor: filters.actor ?? '' }}
    familyOptions={AUDIT_FAMILIES.map((family) => ({ value: `${family}.`, label: to(`families.${family}`) }))}
    actorFilter={filters.actor ? { label: to('filteredByActor', { name: actorName(filters.actor) ?? filters.actor }), clearHref: auditHref({ ...filters, actor: undefined }), clearLabel: to('clearActor') } : undefined}
    clearHref={filtered ? routes.admin.audit() : undefined}
    rows={rows}
    page={page}
    hasMore={hasMore}
    previousHref={page > 1 ? auditHref(filters, page - 1) : null}
    nextHref={hasMore ? auditHref(filters, page + 1) : null}
    labels={{
      family: to('familyLabel'), allFamilies: to('allFamilies'), target: t('target'), targetPlaceholder: to('targetPlaceholder'), apply: to('apply'),
      clearFilters: to('clearFilters'), listTitle: to('listTitle'), time: to('columns.time'), action: to('columns.action'), actor: to('columns.actor'),
      targetColumn: to('columns.target'), system: to('system'), pagination: to('pagination'),
      emptyTitle: filtered ? to('emptyTitle') : t('noActivity'), emptyDescription: filtered ? to('emptyFiltered') : t('auditScopeHint'),
    }}
  />;
}

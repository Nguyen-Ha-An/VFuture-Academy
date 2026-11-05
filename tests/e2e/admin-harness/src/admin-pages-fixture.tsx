import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatStaffAuditAction, formatStaffAuditTarget } from '@/features/admin/audit-format';
import { useRouter } from 'next/navigation';
import { BranchesManager, type SchoolReportCells } from '@/features/admin/components/BranchesManager';
import { FIXTURE_ACTOR_ID, FIXTURE_PEOPLE, FIXTURE_SCHOOLS } from './admin-transport';
import type { AdminScope } from '@/lib/admin-scope';
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

const PEOPLE: Array<[string, string]> = FIXTURE_PEOPLE.slice(0, 5).map(([id, name]) => [id, name]);

export const SCHOOLS = structuredClone(FIXTURE_SCHOOLS);
const fixtureScenario = () => new URLSearchParams(location.search).get('scenario') ?? sessionStorage.getItem('admin-fixture-scenario') ?? 'dense';

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

export function AdminOverviewFixture({ permissions, entries, central, scope }: { permissions: Permission[]; entries: WorkspaceEntries; central: boolean; scope: AdminScope }) {
  const t = useTranslations('centralAdmin');
  const locale = useLocale();
  const data = structuredClone(OVERVIEW_DATA);
  const model = window.__adminFixture.readModel(scope);
  data.members = model.members.length;
  data.schools = model.schools.length;
  if (fixtureScenario() === 'empty') Object.assign(data, { members: 0, enrollments: 0, pendingGrading: 0, pendingReview: 0, pendingInvitations: 0, recentActivity: [], activitySeries: [], schoolRanking: [], reviewPipeline: { pending: 0, changesRequested: 0, approved: 0 }, activeLearners: { ...data.activeLearners!, current: 0, previous: 0 } });
  if (fixtureScenario() === 'sparse') Object.assign(data, { pendingGrading: 1, pendingReview: 1, recentActivity: data.recentActivity?.slice(0, 1), schoolRanking: data.schoolRanking?.slice(0, 1), reviewPipeline: { pending: 1, changesRequested: 0, approved: 0 } });
  if (fixtureScenario() === 'error') Object.assign(data, { activeLearners: undefined, activitySeries: undefined, schoolRanking: undefined, recentActivity: undefined, unavailable: ['activeLearners', 'activitySeries', 'schoolRanking', 'recentActivity'] });
  return <AdminOverviewView {...buildAdminOverviewView({
    data: central ? data : { ...data, schools: undefined, schoolRanking: undefined, reviewPipeline: undefined, pendingReview: undefined, publishedContent: undefined },
    permissions,
    entries,
    locale,
    eyebrow: central ? t('central') : model.schools[0]?.name ?? t('central'),
    title: t('overview'),
    description: t('overviewDescription'),
  })} />;
}

export function BranchesFixture({ canManage, scope, permissions }: { canManage: boolean; scope: AdminScope; permissions: Permission[] }) {
  const schools = window.__adminFixture.readModel(scope).schools;
  const rows = fixtureScenario() === 'empty' ? [] : fixtureScenario() === 'sparse' ? schools.slice(0, 1) : schools;
  return <BranchesManager initialBranches={rows} scope={scope} actorId={FIXTURE_ACTOR_ID} reports={fixtureScenario() === 'error' ? 'unavailable' : permissions.includes('report.branch.read') ? SCHOOL_REPORTS : undefined} canManage={canManage} />;
}
export function SchoolDetailFixture({ branchId, permissions }: { branchId: string; permissions: Permission[] }) {
  const t = useTranslations('centralAdmin');
  const to = useTranslations('staffUi.admin.org.schoolDetail');
  const format = useFormatter();
  const router = useRouter();
  const locale = useLocale();
  const school = window.__adminFixture.readModel().schools.find((entry) => entry.id === branchId);
  if (!school) throw new Error('This local school fixture does not exist.');
  const model = window.__adminFixture.readModel({ kind: 'branch', branchId });
  const params = new URLSearchParams(location.search);
  const canReadMembers = permissions.includes('member.read');
  const canReadReports = permissions.includes('report.branch.read');
  const availableTabs = ['overview', ...(canReadMembers ? ['members', 'staff'] : []), ...(permissions.includes('content.read') ? ['cms'] : [])];
  const tab = availableTabs.includes(params.get('tab') ?? '') ? params.get('tab')! : 'overview';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const cells = SCHOOL_REPORTS[school.id] ?? { activeLearners30d: 0, enrollments: 0, completedEnrollments: 0, completionPercent: null, pendingGrading: 0, averagePercent: null };
  const percent = (value: number | null) => (value === null ? '—' : format.number(value / 100, { style: 'percent', maximumFractionDigits: 1 }));
  const stats: SchoolDetailStat[] = [
    { key: 'members', label: to('stats.members'), value: model.members.length },
    { key: 'enrollments', label: to('stats.enrollments'), value: cells.enrollments },
    { key: 'pendingGrading', label: to('stats.pendingGrading'), value: cells.pendingGrading },
    { key: 'activeLearners', label: to('stats.activeLearners'), value: cells.activeLearners30d },
    { key: 'completion', label: to('stats.completion'), value: percent(cells.completionPercent), hint: to('stats.completedHint', { completed: cells.completedEnrollments, total: cells.enrollments }) },
    { key: 'averageScore', label: to('stats.averageScore'), value: percent(cells.averagePercent) },
  ];
  const tabHref = (key: string, query: Record<string, string> = {}) => routes.admin.branch(school.id, { tab: key === 'overview' ? undefined : key, ...query });
  const people = tab === 'staff' ? model.members.filter((member) => member.assignments.some((assignment) => assignment.roleId !== 'member')) : model.members;
  const hasMore = people.length > page * 10;
  const rows = people.slice((page - 1) * 10, page * 10).map((member) => ({
    id: member.id, name: member.displayName, email: member.email, href: routes.admin.user(member.id),
    roles: member.assignments.map((assignment) => assignment.roleName).join(', ') || to('noRole'),
    status: member.accountStatus === 'suspended' ? 'suspended' as const : member.memberships.find((membership) => membership.branchId === school.id)?.status ?? 'active',
  }));
  return <SchoolDetailView
    school={{ id: school.id, name: school.name, description: school.city ? `${t('schools')} · ${school.city}` : t('schools') }}
    tabs={[
      ...availableTabs.map((key) => ({ key, label: t(key), href: tabHref(key), current: key === tab })),
      ...(canReadReports ? [{ key: 'reports', label: t('reports'), href: routes.grading.reports({ branchId: school.id }), current: false, external: true }] : []),
    ]}
    tabsLabel={to('sections')}
    enter={{ action: async (form) => {
      const response = await fetch('/api/v1/admin/scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: form.get('scope'), destination: form.get('destination'), actorId: FIXTURE_ACTOR_ID }) });
      if (!response.ok) throw new Error('The fixture scope change failed.');
      router.push(String(form.get('destination')));
    }, scope: `branch:${school.id}`, destination: tab === 'cms' ? '/studio/library' : tab === 'members' || tab === 'staff' ? '/admin/users' : '/admin', label: t('enterSchool') }}
    stats={tab === 'overview' ? stats : undefined}
    unavailableLabel={to('unavailable')}
    activity={tab === 'overview' && permissions.includes('audit.read') ? { title: to('activityTitle'), emptyLabel: to('activityEmpty'), items: (fixtureScenario() === 'empty' ? [] : auditEntries(4)).map((entry) => ({ id: entry.id, actor: { name: PEOPLE.find(([id]) => id === entry.actorId)?.[1] ?? (locale === 'vi' ? 'Hệ thống' : 'System') }, action: formatStaffAuditAction(entry.action, locale).label, target: formatStaffAuditTarget(entry.targetType, locale), at: entry.at })) } : undefined}
    members={canReadMembers && (tab === 'members' || tab === 'staff' || tab === 'overview') ? {
      title: tab === 'staff' ? to('staffTitle') : tab === 'overview' ? to('previewTitle') : to('membersTitle'),
      rows: fixtureScenario() === 'error' ? null : tab === 'overview' ? rows.slice(0, 5) : rows,
      page,
      hasMore,
      previousHref: page > 1 ? tabHref(tab, page - 1 > 1 ? { page: String(page - 1) } : {}) : null,
      nextHref: hasMore ? tabHref(tab, { page: String(page + 1) }) : null,
      labels: { member: to('columns.member'), roles: to('columns.roles'), status: to('columns.status'), empty: tab === 'staff' ? to('emptyStaff') : to('emptyMembers'), unavailable: to('membersUnavailable'), pagination: to('pagination') },
      action: tab === 'overview' ? { label: to('viewAllMembers'), href: tabHref('members') } : undefined,
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

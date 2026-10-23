import { notFound, forbidden } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { formatStaffAuditAction, formatStaffAuditTarget } from "@/features/admin/audit-format";
import { adminPageContext } from "@/features/admin/context";
import { enterSchoolWorkspace } from "@/features/admin/actions";
import { BranchIdSchema } from "@/features/admin/branches";
import { can, effectivePermissions } from "@/lib/permissions";
import { scopeKey } from "@/lib/admin-scope";
import { routes } from "@/lib/routes";
import { SchoolDetailView, type SchoolDetailStat } from "../SchoolDetailView";
import { schoolMembers, schoolOverview } from "../data";

function pageNumber(raw: string | undefined) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : 1;
}

export default async function BranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const [context, { branchId: raw }, { tab: rawTab, page: rawPage }, t, to, format] = await Promise.all([
    adminPageContext(),
    params,
    searchParams,
    getTranslations("centralAdmin"),
    getTranslations("staffUi.admin.org.schoolDetail"),
    getFormatter(),
  ]);
  const [tm, ta, locale] = await Promise.all([
    getTranslations("staffUi.admin.members.profile"),
    getTranslations("staffUi.admin.org.audit"),
    getLocale(),
  ]);
  const parsed = BranchIdSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const branch = context.branches.find((b) => b.id === parsed.data);
  if (!branch) notFound();
  const scope = { kind: "branch" as const, branchId: branch.id };
  if (!can(context.actor, "branch.read", scope)) forbidden();
  const selected = {
    ...context,
    scope,
    permissions: effectivePermissions(context.actor, scope),
  };
  const canReadReports = can(context.actor, "report.branch.read", scope);
  const tabs = [
    "overview",
    ...(can(context.actor, "member.read", scope) ? ["members", "staff"] : []),
    ...(can(context.actor, "content.read", scope) ? ["cms"] : []),
  ];
  const tab = tabs.includes(rawTab ?? "") ? rawTab! : "overview";
  const page = pageNumber(rawPage);
  const tabHref = (key: string, query: Record<string, string> = {}) =>
    routes.admin.branch(branch.id, { tab: key === "overview" ? undefined : key, ...query });

  const canReadMembers = can(context.actor, "member.read", scope);
  const [overview, members] = await Promise.all([
    tab === "overview" ? schoolOverview(selected, branch.id, { withReports: canReadReports }) : null,
    tab === "members" || tab === "staff"
      ? schoolMembers(selected, { page, staff: tab === "staff" })
      // The overview previews the first members, so the page has a data card, not just KPIs.
      : tab === "overview" && canReadMembers ? schoolMembers(selected, { page: 1, staff: false }) : null,
  ]);
  const memberRow = (member: NonNullable<typeof members>["items"][number]) => ({
    id: member.id,
    name: member.displayName,
    email: member.email,
    href: routes.admin.user(member.id),
    roles: member.assignments.map((assignment) => assignment.roleName).join(", ") || to("noRole"),
    // Same rule as memberStatus() in member-admin-ui: a suspended account wins,
    // otherwise the membership in this school decides.
    status: member.accountStatus === "suspended"
      ? "suspended" as const
      : (member.memberships.find((membership) => membership.branchId === branch.id)?.status ?? "active"),
  });
  const memberLabels = (staff: boolean) => ({
    member: to("columns.member"),
    roles: to("columns.roles"),
    status: to("columns.status"),
    empty: staff ? to("emptyStaff") : to("emptyMembers"),
    unavailable: to("membersUnavailable"),
    pagination: to("pagination"),
  });
  const actorName = (id: string | null) => (id ? overview?.actors?.[id.toLowerCase()]?.name : undefined);
  const activity = overview?.counts?.recentActivity
    ? {
        title: to("activityTitle"),
        emptyLabel: to("activityEmpty"),
        items: overview.counts.recentActivity.slice(0, 6).map((entry) => {
          const label = formatStaffAuditAction(entry.action, locale).label;
          const target = entry.targetType === "user" ? actorName(entry.targetId) : undefined;
          return {
            id: entry.id,
            actor: { name: actorName(entry.actorId) ?? (entry.actorId ? tm("unknownGrantor") : ta("system")) },
            // The verb follows the name: lower-case in Vietnamese ("Lan đã cấp vai trò").
            action: locale === "vi" && label ? label.charAt(0).toLocaleLowerCase("vi") + label.slice(1) : label,
            target: target ?? formatStaffAuditTarget(entry.targetType, locale),
            href: entry.targetType === "user" && canReadMembers ? routes.admin.user(entry.targetId) : undefined,
            at: entry.at,
          };
        }),
      }
    : undefined;

  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value / 100, { style: "percent", maximumFractionDigits: 1 });
  const stats: SchoolDetailStat[] = [];
  if (overview) {
    const { counts, report } = overview;
    for (const key of ["members", "enrollments", "pendingGrading"] as const) {
      // A count the actor may not read is absent from the dashboard: hide it; a failed read says Unavailable.
      if (counts === null) stats.push({ key, label: to(`stats.${key}`), value: null });
      else if (counts[key] !== undefined) stats.push({ key, label: to(`stats.${key}`), value: counts[key] ?? null });
    }
    if (report.state !== "hidden") {
      const cells = report.state === "ready" ? report.cells : null;
      const failed = report.state === "unavailable";
      stats.push(
        { key: "activeLearners", label: to("stats.activeLearners"), value: failed ? null : cells ? cells.activeLearners30d : "—" },
        {
          key: "completion",
          label: to("stats.completion"),
          value: failed ? null : percent(cells?.completionPercent ?? null),
          hint: cells ? to("stats.completedHint", { completed: cells.completedEnrollments, total: cells.enrollments }) : undefined,
        },
        { key: "averageScore", label: to("stats.averageScore"), value: failed ? null : percent(cells?.averagePercent ?? null) },
      );
    }
  }

  const destination =
    tab === "cms"
      ? "/studio/library"
      : tab === "members" || tab === "staff"
        ? "/admin/users"
        : "/admin";

  const viewTabs = [
    ...tabs.map((key) => ({ key, label: t(key), href: tabHref(key), current: key === tab })),
    ...(canReadReports
      ? [{ key: "reports", label: t("reports"), href: routes.grading.reports({ branchId: branch.id }), current: false, external: true }]
      : []),
  ];

  return (
    <SchoolDetailView
      school={{ id: branch.id, name: branch.name, description: branch.city ? `${t("schools")} · ${branch.city}` : t("schools") }}
      tabs={viewTabs}
      tabsLabel={to("sections")}
      enter={{ action: enterSchoolWorkspace, scope: scopeKey(scope), destination, label: t("enterSchool") }}
      stats={overview ? stats : undefined}
      unavailableLabel={to("unavailable")}
      activity={activity}
      members={
        tab === "members" || tab === "staff"
          ? {
              title: tab === "staff" ? to("staffTitle") : to("membersTitle"),
              rows: members ? members.items.map(memberRow) : null,
              page,
              hasMore: members?.hasMore ?? false,
              previousHref: page > 1 ? tabHref(tab, page - 1 > 1 ? { page: String(page - 1) } : {}) : null,
              nextHref: members?.hasMore ? tabHref(tab, { page: String(page + 1) }) : null,
              labels: memberLabels(tab === "staff"),
            }
          : tab === "overview" && canReadMembers
            ? {
                title: to("previewTitle"),
                rows: members ? members.items.slice(0, 5).map(memberRow) : null,
                page: 1,
                hasMore: false,
                previousHref: null,
                nextHref: null,
                labels: memberLabels(false),
                action: { label: to("viewAllMembers"), href: tabHref("members") },
              }
            : undefined
      }
      note={tab === "cms" ? to("cmsDescription") : undefined}
    />
  );
}

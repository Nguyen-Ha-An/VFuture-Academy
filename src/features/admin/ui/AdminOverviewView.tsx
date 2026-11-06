import "./admin.css";
import { useTranslations } from "next-intl";
import {
  BookOpenCheck,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  School,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { CanvasButton as Button } from "@/features/canvas/ui";
import {
  ActivityFeed,
  ChartCard,
  StatCard,
  StatGrid,
  type ActivityItem,
} from "@/features/staff-ui/components/insights";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import { SchoolActivityCard } from "./overview/SchoolActivityCard";
import type {
  AdminOverviewViewProps,
  OverviewActivityItem,
  OverviewKpi,
  OverviewKpiKey,
} from "./overview/view-model";

export type { AdminOverviewViewProps } from "./overview/view-model";

const KPI_ICONS: Record<OverviewKpiKey, LucideIcon> = {
  members: Users,
  activeLearners: UsersRound,
  pendingGrading: ClipboardCheck,
  pendingReview: FileCheck2,
  schools: School,
  enrollments: GraduationCap,
  publishedContent: BookOpenCheck,
};

// Summary counts link to permitted work queues before the historical activity.
// Props are plain data from buildAdminOverviewView(), so a harness can render fixtures.
export function AdminOverviewView({
  eyebrow,
  title,
  description,
  inviteHref,
  kpis,
  activity,
  schools,
  recent,
  auditHref,
}: AdminOverviewViewProps) {
  const t = useTranslations("staffUi.admin.overview");
  const insights = useTranslations("staffUi.insights");

  const kpiHint = (kpi: OverviewKpi) => {
    if (kpi.key === "activeLearners") return t("kpi.activeLearnersHint");
    if (kpi.key === "pendingGrading") return t("kpi.pendingGradingHint");
    if (kpi.key === "pendingReview") return t("kpi.pendingReviewHint");
    if (kpi.pendingInvitations === undefined) return undefined;
    return kpi.pendingInvitations === null
      ? t("kpi.pendingInvitationsUnavailable")
      : t("kpi.pendingInvitations", { count: kpi.pendingInvitations });
  };

  const summaryKpis = kpis;

  const feedItems: ActivityItem[] =
    recent?.state === "ready" ? recent.items.map((item) => feedItem(item)) : [];
  function feedItem(item: OverviewActivityItem): ActivityItem {
    const actor =
      item.actor.kind === "person"
        ? { name: item.actor.name, avatarUrl: item.actor.avatarUrl }
        : { name: t(item.actor.kind === "system" ? "recent.system" : "recent.unknownActor") };
    return { id: item.id, actor, action: item.action, target: item.target, href: item.href, at: item.at };
  }

  const totals = activity?.state === "ready"
    ? activity.days.reduce(
      (sum, day) => ({ lessons: sum.lessons + day.lessonCompletions, attempts: sum.attempts + day.attempts }),
      { lessons: 0, attempts: 0 },
    )
    : null;

  const hasInsightRow = Boolean(activity || schools);

  return <div className="canvas-page canvas-admin canvas-admin-overview flex flex-col gap-6">
    <StaffPageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={inviteHref
        ? <Button href={inviteHref} renderIcon={<UserPlus aria-hidden="true" />}>{t("inviteMember")}</Button>
        : undefined}
    />


    {summaryKpis.length ? <StatGrid className="admin-metrics">
      {summaryKpis.map((kpi) => <StatCard
        key={kpi.key}
        label={t(`kpi.${kpi.key}`)}
        value={kpi.value}
        icon={KPI_ICONS[kpi.key]}
        href={kpi.href}
        hint={kpiHint(kpi)}
        delta={kpi.delta === undefined
          ? undefined
          : { value: kpi.delta, label: t("kpi.previousWindow"), goodDirection: "up" }}
      />)}
    </StatGrid> : null}

    {hasInsightRow ? <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      {activity ? <ChartCard
        className={schools ? "lg:col-span-2" : "lg:col-span-3"}
        height={180}
        kind="area"
        title={t("activity.title")}
        description={t("activity.description")}
        data={activity.state === "ready" ? activity.days : []}
        categoryKey="day"
        categoryFormat="day"
        categoryLabel={t("activity.day")}
        series={[
          { key: "lessonCompletions", label: t("activity.lessons"), color: "var(--primary)" },
          { key: "attempts", label: t("activity.attempts"), color: "var(--muted-foreground)", fill: false },
        ]}
        state={activity.state}
        footer={totals ? t("activity.summary", totals) : undefined}
      /> : null}
      {schools ? <SchoolActivityCard
        className={activity ? undefined : "lg:col-span-3"}
        state={schools.state}
        rows={schools.state === "ready" ? schools.rows : undefined}
      /> : null}
    </div> : null}

    {recent ? <ActivityFeed
      title={t("recent.title")}
      items={feedItems}
      emptyLabel={recent.state === "unavailable" ? insights("unavailable") : t("recent.empty")}
      footerHref={auditHref}
      footerLabel={t("recent.viewAll")}
    /> : null}
  </div>;
}

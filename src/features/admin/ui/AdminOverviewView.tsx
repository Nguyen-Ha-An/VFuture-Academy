import { useId } from "react";
import { useFormatter } from "next-intl";
import "./admin.css";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
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
import { CanvasButton as Button, CanvasLink } from "@/features/canvas/ui";
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

// Keep waiting work directly below the summary so administrators can act before
// reading historical activity. Every destination remains permission-filtered by the model.
// Props are plain data from buildAdminOverviewView(), so a harness can render fixtures.
export function AdminOverviewView({
  eyebrow,
  title,
  description,
  inviteHref,
  kpis,
  activity,
  schools,
  pipeline,
  recent,
  auditHref,
}: AdminOverviewViewProps) {
  const t = useTranslations("staffUi.admin.overview");
  const insights = useTranslations("staffUi.insights");
  const format = useFormatter();
  const workTitleId = useId();

  const kpiHint = (kpi: OverviewKpi) => {
    if (kpi.key === "activeLearners") return t("kpi.activeLearnersHint");
    if (kpi.key === "pendingGrading") return t("kpi.pendingGradingHint");
    if (kpi.key === "pendingReview") return t("kpi.pendingReviewHint");
    if (kpi.pendingInvitations === undefined) return undefined;
    return kpi.pendingInvitations === null
      ? t("kpi.pendingInvitationsUnavailable")
      : t("kpi.pendingInvitations", { count: kpi.pendingInvitations });
  };

  // Counts that already appear in the waiting-work queue need no second KPI.
  const summaryKpis = kpis.filter((kpi) =>
    !(kpi.key === "pendingReview" && pipeline?.some((stage) => stage.key === "pending")) &&
    !(kpi.key === "pendingGrading" && pipeline?.some((stage) => stage.key === "pendingGrading")),
  );

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

    {pipeline?.length ? <section className="admin-work" aria-labelledby={workTitleId}>
      <div className="admin-section-heading">
        <h2 id={workTitleId}>{t("pipeline.title")}</h2>
        <p>{t("pipeline.description")}</p>
      </div>
      <ol className="admin-work-list">
        {pipeline.map((stage) => <li key={stage.key} data-stage={stage.key} data-tone={stage.tone}>
          <span className="admin-work-count">{stage.count === null ? insights("unavailable") : format.number(stage.count)}</span>
          {stage.href ? <CanvasLink href={stage.href}>
            <span className="admin-work-link">{t(`pipeline.${stage.key}`)}<ArrowRight aria-hidden="true" size={16} /></span>
          </CanvasLink> : <span className="admin-work-status">{t(`pipeline.${stage.key}`)}</span>}
        </li>)}
      </ol>
    </section> : null}

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

    {hasInsightRow ? <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
      {activity ? <ChartCard
        className={schools ? "lg:col-span-2" : "lg:col-span-3"}
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

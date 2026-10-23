import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import {
  ActivityFeed,
  ChartCard,
  PipelineStrip,
  StatCard,
  StatGrid,
  type ActivityItem,
  type PipelineStage,
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

// The admin overview (Catmin dashboard anatomy): H1 + one primary action, KPI row,
// insight row (activity chart, school distribution, work pipeline), recent activity.
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

  const kpiHint = (kpi: OverviewKpi) => {
    if (kpi.key === "activeLearners") return t("kpi.activeLearnersHint");
    if (kpi.key === "pendingGrading") return t("kpi.pendingGradingHint");
    if (kpi.key === "pendingReview") return t("kpi.pendingReviewHint");
    if (kpi.pendingInvitations === undefined) return undefined;
    return kpi.pendingInvitations === null
      ? t("kpi.pendingInvitationsUnavailable")
      : t("kpi.pendingInvitations", { count: kpi.pendingInvitations });
  };

  const stages: PipelineStage[] | undefined = pipeline?.map((stage) => ({
    key: stage.key,
    label: t(`pipeline.${stage.key}`),
    count: stage.count,
    tone: stage.tone,
    href: stage.href,
  }));

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

  return <div className="flex flex-col gap-6">
    <StaffPageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={inviteHref
        ? <Button asChild>
          <Link href={inviteHref}><UserPlus aria-hidden="true" />{t("inviteMember")}</Link>
        </Button>
        : undefined}
    />

    {kpis.length ? <StatGrid>
      {kpis.map((kpi) => <StatCard
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
          { key: "lessonCompletions", label: t("activity.lessons") },
          { key: "attempts", label: t("activity.attempts") },
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

    {stages ? <PipelineStrip
      title={t("pipeline.title")}
      description={t("pipeline.description")}
      stages={stages}
    /> : null}

    {recent ? <ActivityFeed
      title={t("recent.title")}
      items={feedItems}
      emptyLabel={recent.state === "unavailable" ? insights("unavailable") : t("recent.empty")}
      footerHref={auditHref}
      footerLabel={t("recent.viewAll")}
    /> : null}
  </div>;
}

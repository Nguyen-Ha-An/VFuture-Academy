import "@/features/admin/ui/admin.css";
import Link from "next/link";
import { ArrowUpRightIcon, LogInIcon } from "lucide-react";

import { CanvasButton as Button } from "@/features/canvas/ui";
import { SchoolMembersTable } from "@/features/admin/ui/SchoolMembersTable";
import { SchoolScopeContinue, SchoolScopeLink } from "@/features/admin/components/SchoolScopeNavigation";
import type { SchoolNavigation } from "@/features/admin/school-navigation";
import {
  ActivityFeed,
  DataCard,
  DataPagination,
  EmptyState,
  type ActivityItem,
  StatCard,
  StatGrid,
  type MemberStatus,
} from "@/features/staff-ui/components";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";
import { cn } from "@/lib/ui-cn";

export type SchoolDetailTab = {
  key: string;
  label: string;
  href: string;
  current: boolean;
  /** Opens another workspace (e.g. grading reports) instead of a tab on this page. */
  external?: boolean;
  navigation?: SchoolNavigation;
};

export type SchoolDetailStat = {
  key: string;
  label: string;
  /** A number, a preformatted string (percent), or null for "Unavailable". */
  value: number | string | null;
  hint?: string;
};

export type SchoolMemberRow = {
  id: string;
  name: string;
  email: string;
  href: string;
  roles: string;
  status: MemberStatus;
  navigation?: SchoolNavigation;
};

export type SchoolDetailViewProps = {
  school: { id: string; name: string; description: string };
  tabs: SchoolDetailTab[];
  tabsLabel: string;
  /** "Enter school": a form posting the scope key and destination to a server action. */
  enter?: {
    action?: (form: FormData) => void | Promise<void>;
    scope?: string;
    destination?: string;
    label: string;
    navigation?: SchoolNavigation;
  };
  stats?: SchoolDetailStat[];
  unavailableLabel: string;
  members?: {
    title: string;
    /** null when the read failed. */
    rows: SchoolMemberRow[] | null;
    page: number;
    hasMore: boolean;
    previousHref: string | null;
    nextHref: string | null;
    labels: { member: string; roles: string; status: string; empty: string; unavailable: string; pagination: string };
    /** Overview preview: a link to the full list in the card header. */
    action?: { label: string; href: string };
  };
  /** Overview insight: the school's recent activity (hidden without audit access). */
  activity?: { title: string; emptyLabel: string; items: ActivityItem[] };
  note?: string;
};

/**
 * /admin/branches/[branchId]: header with "Enter school", tab links, the school's KPI row and a
 * paged member table. Presentational: every string and href arrives as a prop.
 */
export function SchoolDetailView({ school, tabs, tabsLabel, enter, stats, unavailableLabel, members, activity, note }: SchoolDetailViewProps) {
  return (
    <section className="canvas-page canvas-admin space-y-6">
      <StaffPageHeader
        title={school.name}
        description={school.description}
        actions={
          enter?.navigation ? <SchoolScopeContinue navigation={enter.navigation} label={enter.label} /> : enter?.action ? <form action={enter.action}>
            <input type="hidden" name="scope" value={enter.scope} />
            <input type="hidden" name="destination" value={enter.destination} />
            <Button type="submit">
              <LogInIcon aria-hidden="true" />
              {enter.label}
            </Button>
          </form> : undefined
        }
      />
      <nav aria-label={tabsLabel} className="flex flex-nowrap gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => tab.navigation ? (
          <SchoolScopeLink key={tab.key} navigation={tab.navigation} current={tab.current ? "page" : undefined}
            className={cn("-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", tab.current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {tab.label}{tab.external ? <ArrowUpRightIcon aria-hidden="true" className="size-3.5" /> : null}
          </SchoolScopeLink>
        ) : (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.current ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              tab.current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.external ? <ArrowUpRightIcon aria-hidden="true" className="size-3.5" /> : null}
          </Link>
        ))}
      </nav>
      {stats?.length ? (
        <StatGrid className="xl:grid-cols-3">
          {stats.map((stat) => (
            <StatCard key={stat.key} label={stat.label} value={stat.value} hint={stat.hint} unavailableLabel={unavailableLabel} />
          ))}
        </StatGrid>
      ) : null}
      {members ? (
        <DataCard
          className="canvas-panel"
          title={members.title}
          actions={members.action ? <Button href={members.action.href} variant="outline" size="sm">{members.action.label}</Button> : undefined}
          footer={members.rows && !members.action ? (
            <DataPagination
              mode="hasMore"
              page={members.page}
              hasMore={members.hasMore}
              previousHref={members.previousHref}
              nextHref={members.nextHref}
              label={members.labels.pagination}
            />
          ) : undefined}
        >
          {members.rows === null ? (
            <p role="alert" className="p-6 text-sm leading-normal text-muted-foreground">{members.labels.unavailable}</p>
          ) : members.rows.length === 0 ? (
            <div className="p-6"><EmptyState title={members.labels.empty} /></div>
          ) : (
            <SchoolMembersTable title={members.title} rows={members.rows} labels={members.labels} />
          )}
        </DataCard>
      ) : null}
      {activity ? (
        <ActivityFeed title={activity.title} items={activity.items} emptyLabel={activity.emptyLabel} />
      ) : null}
      {note ? <p className="text-sm leading-normal text-muted-foreground">{note}</p> : null}
    </section>
  );
}

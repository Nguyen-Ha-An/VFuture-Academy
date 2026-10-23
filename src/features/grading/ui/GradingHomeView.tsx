import Link from 'next/link';
import { ArrowRight, ClipboardCheck, FileClock, Hourglass, Inbox, NotebookPen } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ActivityFeed,
  ChartCard,
  DataCard,
  EmptyState,
  PipelineStrip,
  STATUS_TONE_MAP,
  StatCard,
  StatGrid,
  StatusBadge,
  type ActivityItem,
  type PipelineStage,
} from '@/features/staff-ui/components';
import type { SubmissionStatus } from '@/features/instructor-grading/types';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { routes } from '@/lib/routes';

const DAY_MS = 86_400_000;
const PIPELINE_STATUSES = ['submitted', 'in_review', 'approved', 'changes_requested'] as const satisfies readonly SubmissionStatus[];

/** Plain, serializable mirror of `GradingOverview` (src/features/grading/overview.ts), so a harness can pass fixtures. */
export type GradingHomeOverview = {
  generatedAt: string;
  statusCounts: Record<SubmissionStatus, number> | null;
  waiting: number | null;
  examsAwaitingManual: number | null;
  gradedLast7Days: number | null;
  gradedPrior7Days: number | null;
  oldest: {
    id: string;
    /** Null when unresolved; the view shows a placeholder rather than a raw id. */
    learnerName: string | null;
    courseTitle: string | null;
    itemTitle: string | null;
    status: SubmissionStatus;
    submittedAt: string;
    href: string;
  }[] | null;
  throughput: { day: string; received: number; released: number }[] | null;
  recent: {
    id: string;
    graderName: string | null;
    graderAvatarUrl: string | null;
    learnerName: string | null;
    itemTitle: string | null;
    released: boolean;
    decision: 'approved' | 'changes_requested';
    gradedAt: string;
    href: string;
  }[] | null;
};

export type GradingHomeViewProps = {
  /** Workspace destinations the active scope reaches (labels come from `gradingNav.<key>`). */
  destinations: readonly { key: string; href: string }[];
  /** Absent for report-only operators: they see the report shortcuts alone. */
  overview?: GradingHomeOverview | null;
};

function waitingDays(submittedAt: string, now: string): number | null {
  const from = new Date(submittedAt).getTime();
  const to = new Date(now).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/** `/grading`: H1 + "Grade next" → KPI row → status strip → throughput and recent grades → oldest waiting → shortcuts. */
export function GradingHomeView({ destinations, overview }: GradingHomeViewProps) {
  const nav = useTranslations('gradingNav');
  const t = useTranslations('staffUi.grading.home');
  const grading = useTranslations('studio.grading');
  const insights = useTranslations('staffUi.insights');
  const format = useFormatter();

  const next = overview?.oldest?.[0];
  const gradeNextReason = overview && !next
    ? overview.oldest === null ? t('gradeNextUnavailable') : t('gradeNextEmpty')
    : null;
  const gradeNext = overview
    ? next
      ? <Button asChild><Link href={next.href}>{t('gradeNext')}<ArrowRight aria-hidden="true" /></Link></Button>
      : <div className="flex flex-col items-end gap-1">
        <Button disabled aria-describedby="grade-next-reason">{t('gradeNext')}<ArrowRight aria-hidden="true" /></Button>
        <p id="grade-next-reason" className="text-xs leading-normal text-muted-foreground">{gradeNextReason}</p>
      </div>
    : undefined;

  const oldest = overview?.oldest;
  const oldestDays = next && overview ? waitingDays(next.submittedAt, overview.generatedAt) : null;
  const oldestValue = oldest === null || oldest === undefined
    ? null
    : !next ? t('kpi.oldestNone') : oldestDays === null ? null : t('kpi.oldestValue', { days: oldestDays });
  const gradedDelta = overview && overview.gradedLast7Days !== null && overview.gradedPrior7Days !== null
    ? { value: overview.gradedLast7Days - overview.gradedPrior7Days, label: t('kpi.gradedDelta'), goodDirection: 'up' as const }
    : undefined;

  const stages: PipelineStage[] = PIPELINE_STATUSES.map((status) => ({
    key: status,
    label: grading(`status.${status}`),
    count: overview?.statusCounts ? overview.statusCounts[status] : null,
    tone: STATUS_TONE_MAP.submission[status],
    href: routes.grading.queue({ status }),
  }));

  const activity: ActivityItem[] = (overview?.recent ?? []).map((grade) => ({
    id: grade.id,
    actor: { name: grade.graderName ?? t('recent.unknownGrader'), avatarUrl: grade.graderAvatarUrl },
    action: grade.released ? t('recent.released') : t('recent.draft'),
    target: t('recent.target', { learner: grade.learnerName ?? t('unknownLearner'), item: grade.itemTitle ?? t('unknownItem') }),
    href: grade.href,
    at: grade.gradedAt,
  }));

  return <section className="mx-auto max-w-7xl space-y-6">
    {/* No eyebrow: it would repeat the H1 (the workspace and its overview share a name). */}
    <StaffPageHeader title={nav('overview')} description={nav('overviewDescription')} actions={gradeNext} />

    {overview ? <>
      <StatGrid>
        <StatCard
          label={t('kpi.waiting')}
          value={overview.waiting}
          icon={Inbox}
          hint={t('kpi.waitingHint')}
          href={routes.grading.queue({ status: 'pending' })}
        />
        <StatCard
          label={t('kpi.exams')}
          value={overview.examsAwaitingManual}
          icon={NotebookPen}
          hint={t('kpi.examsHint')}
        />
        <StatCard
          label={t('kpi.oldest')}
          value={oldestValue}
          icon={Hourglass}
          hint={next ? t('kpi.oldestHint', { date: format.dateTime(new Date(next.submittedAt), { dateStyle: 'medium' }) }) : undefined}
        />
        <StatCard
          label={t('kpi.graded')}
          value={overview.gradedLast7Days}
          icon={ClipboardCheck}
          hint={t('kpi.gradedHint')}
          delta={gradedDelta}
        />
      </StatGrid>

      <PipelineStrip title={t('pipeline.title')} description={t('pipeline.description')} stages={stages} />

      <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
        <ChartCard
          className="xl:col-span-2"
          title={t('chart.title')}
          description={t('chart.description')}
          kind="area"
          data={overview.throughput ?? []}
          categoryKey="day"
          categoryFormat="day"
          categoryLabel={t('chart.day')}
          series={[{ key: 'received', label: t('chart.received') }, { key: 'released', label: t('chart.released'), color: 'var(--chart-3)', fill: false }]}
          state={overview.throughput ? 'ready' : 'unavailable'}
        />
        {overview.recent
          ? <ActivityFeed title={t('recent.title')} items={activity} emptyLabel={t('recent.empty')} now={new Date(overview.generatedAt)} />
          : <section aria-labelledby="recent-grades-title" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
            <h2 id="recent-grades-title" className="text-sm font-medium leading-snug">{t('recent.title')}</h2>
            <p className="text-sm leading-normal text-muted-foreground">{insights('unavailable')}</p>
          </section>}
      </div>

      <DataCard
        title={t('oldest.title')}
        description={t('oldest.description')}
        actions={<Button asChild variant="outline" size="sm"><Link href={routes.grading.queue({ status: 'pending' })}>{t('oldest.openQueue')}</Link></Button>}
      >
        {oldest === null
          ? <p className="px-6 py-10 text-center text-sm leading-normal text-muted-foreground">{insights('unavailable')}</p>
          : oldest && oldest.length
            ? <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{grading('table.learner')}</TableHead>
                  <TableHead scope="col" className="hidden sm:table-cell">{grading('table.courseItem')}</TableHead>
                  <TableHead scope="col">{t('oldest.waiting')}</TableHead>
                  <TableHead scope="col" className="hidden sm:table-cell">{grading('table.status')}</TableHead>
                  <TableHead scope="col"><span className="sr-only">{grading('table.action')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oldest.map((item) => {
                  const days = waitingDays(item.submittedAt, overview.generatedAt);
                  return <TableRow key={item.id}>
                    <TableCell className="font-medium whitespace-normal">
                      <span className="block leading-normal">{item.learnerName ?? t('unknownLearner')}</span>
                      {/* On phones the course and status columns are hidden; item and status stay under the name. */}
                      <span className="block text-xs font-normal leading-normal text-muted-foreground sm:hidden">{item.itemTitle ?? t('unknownItem')}</span>
                      <span className="mt-1 block sm:hidden"><StatusBadge kind="submission" value={item.status} label={grading(`status.${item.status}`)} /></span>
                    </TableCell>
                    <TableCell className="hidden min-w-48 whitespace-normal py-3 sm:table-cell">
                      <span className="block font-medium leading-normal">{item.courseTitle ?? t('unknownCourse')}</span>
                      <span className="block text-xs leading-normal text-muted-foreground">{item.itemTitle ?? t('unknownItem')}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <time dateTime={item.submittedAt} title={format.dateTime(new Date(item.submittedAt), { dateStyle: 'medium', timeStyle: 'short' })}>
                        {days === null ? '—' : t('kpi.oldestValue', { days })}
                      </time>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell"><StatusBadge kind="submission" value={item.status} label={grading(`status.${item.status}`)} /></TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline"><Link href={item.href}>{grading('gradeAction')}</Link></Button>
                    </TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
            : <div className="p-6"><EmptyState icon={<FileClock />} title={t('oldest.empty')} description={t('oldest.emptyDescription')} /></div>}
      </DataCard>
    </> : null}

    <nav aria-label={t('shortcuts.title')}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((item) => <li key={item.key}>
          <Link
            href={item.href}
            className="flex h-full flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          >
            <span className="text-sm font-medium leading-normal">{nav(item.key)}</span>
            <span className="text-sm leading-normal text-muted-foreground">{nav('openWorkspace')} →</span>
          </Link>
        </li>)}
      </ul>
    </nav>
  </section>;
}

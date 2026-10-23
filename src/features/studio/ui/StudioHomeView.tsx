import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ActivityFeed, ChartCard, PipelineStrip, StatCard, StatGrid, type ActivityItem } from '@/features/staff-ui/components/insights';
import type { StudioHomeData, StudioOwner } from '@/features/studio/home-data';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { StudioHomeAnchor } from './home/StudioHomeAnchor';
import { CONTENT_STAGES, STAGE_TONES, type ContentStage } from './home/stages';

export type StudioHomeViewProps = { data: StudioHomeData };

/**
 * Studio dashboard: H1 + one primary action, KPI row, lifecycle strip, content-by-type chart with the
 * recent activity feed, then the anchor list and the shortcuts. Presentational: every value comes from
 * studioHomeData(), so a harness can render it with fixtures. Stage counts are snapshots (no deltas).
 */
export function StudioHomeView({ data }: StudioHomeViewProps) {
  const t = useTranslations('staffUi.studio.home');
  const types = useTranslations('cmsAdmin.types');
  const typeLabel = (type: string) => (types.has(type) ? types(type) : type);
  const ownerLabel = (owner: StudioOwner) => (owner.kind === 'central' ? t('central') : owner.name);
  const stageHref = (stage: ContentStage) => (data.libraryHref ? `${data.libraryHref}?status=${stage}` : undefined);
  const { content, reviews, activity } = data;
  const contentStages = content.state === 'ready' ? content.stages : null;

  const kpis: Array<{ key: string; label: string; value: number | null; hint?: string; href?: string }> = [];
  if (reviews.state !== 'hidden') {
    kpis.push({ key: 'waiting', label: t('kpi.waiting'), value: reviews.state === 'ready' ? reviews.pending : null, hint: t('kpi.waitingHint'), href: data.reviewsHref ?? undefined });
  } else if (content.state !== 'hidden') {
    kpis.push({ key: 'waiting', label: t('kpi.waiting'), value: contentStages?.in_review ?? null, hint: t('kpi.waitingItemsHint'), href: stageHref('in_review') });
  }
  if (content.state !== 'hidden') {
    kpis.push(
      { key: 'changes', label: t('kpi.changesRequested'), value: contentStages?.changes_requested ?? null, href: stageHref('changes_requested') },
      { key: 'drafts', label: t('kpi.drafts'), value: contentStages?.draft ?? null, href: stageHref('draft') },
      { key: 'published', label: t('kpi.published'), value: contentStages?.published ?? null, href: stageHref('published') },
    );
  }

  // Four series at most, so a five-step grey ramp keeps every segment distinguishable: the three
  // review stages (in review, changes requested, approved) read as one "In the review flow" band.
  const chartGroups = [
    { key: 'draft', stages: ['draft'], label: t('stages.draft'), color: 'var(--chart-4)' },
    { key: 'review', stages: ['in_review', 'changes_requested', 'approved'], label: t('chart.reviewFlow'), color: 'var(--chart-2)' },
    { key: 'published', stages: ['published'], label: t('stages.published'), color: 'var(--chart-1)' },
    { key: 'archived', stages: ['archived'], label: t('stages.archived'), color: 'var(--chart-5)' },
  ] as const satisfies readonly { key: string; stages: readonly ContentStage[]; label: string; color: string }[];
  const groupCount = (counts: Record<ContentStage, number>, stages: readonly ContentStage[]) => stages.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
  const chartSeries = chartGroups
    .filter((group) => content.state === 'ready' && content.byType.some((row) => groupCount(row.counts, group.stages) > 0))
    .map(({ key, label, color }) => ({ key, label, color }));
  const chartRows = content.state === 'ready'
    ? content.byType.map((row) => ({ type: typeLabel(row.contentType), ...Object.fromEntries(chartGroups.map((group) => [group.key, groupCount(row.counts, group.stages)])) }))
    : [];

  const feed: ActivityItem[] =
    activity.state === 'ready'
      ? activity.items.map((item) => ({
          id: item.id,
          actor:
            item.actor.kind === 'owner'
              ? { name: ownerLabel(item.actor.owner) }
              : { name: item.actor.name ?? t('unknownPerson'), avatarUrl: item.actor.avatarUrl },
          action: t(item.kind === 'updated' ? 'activity.updated' : 'activity.submitted'),
          target: item.target,
          href: item.href ?? undefined,
          at: item.at ?? '',
        }))
      : [];

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <StaffPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          data.primary ? (
            <Button asChild>
              <Link href={data.primary.href}>{t(`primary.${data.primary.key}`)}</Link>
            </Button>
          ) : undefined
        }
      />

      {kpis.length ? (
        <StatGrid aria-label={t('kpi.label')}>
          {kpis.map((kpi) => (
            <StatCard key={kpi.key} label={kpi.label} value={kpi.value} hint={kpi.value === null ? undefined : kpi.hint} href={kpi.href} />
          ))}
        </StatGrid>
      ) : null}

      {content.state !== 'hidden' ? (
        <PipelineStrip
          title={t('pipeline.title')}
          description={t('pipeline.description')}
          stages={CONTENT_STAGES.map((stage) => ({
            key: stage,
            label: t(`stages.${stage}`),
            count: contentStages ? contentStages[stage] : null,
            tone: STAGE_TONES[stage],
            href: contentStages ? stageHref(stage) : undefined,
          }))}
        />
      ) : null}

      {content.state !== 'hidden' || activity.state !== 'hidden' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {content.state !== 'hidden' ? (
            <ChartCard
              title={t('chart.title')}
              description={t('chart.description')}
              kind="bar"
              stacked
              orientation="rows"
              categoryKey="type"
              categoryLabel={t('chart.category')}
              data={chartRows}
              series={chartSeries}
              state={content.state === 'ready' ? 'ready' : 'unavailable'}
              height={Math.max(200, chartRows.length * 44 + 72)}
              footer={content.state === 'ready' && content.total > 0 ? t('chart.summary', { total: content.total, types: content.byType.length }) : undefined}
            />
          ) : null}
          {activity.state !== 'hidden' ? (
            <ActivityFeed
              title={t('activity.title')}
              items={feed}
              emptyLabel={activity.state === 'unavailable' ? t('activity.unavailable') : t('activity.empty')}
              now={new Date(data.generatedAt)}
            />
          ) : null}
        </div>
      ) : null}

      <StudioHomeAnchor data={data} />

      {data.shortcuts.length ? (
        <nav aria-label={t('shortcuts.title')} className="space-y-3">
          <h2 className="text-sm font-medium leading-normal">{t('shortcuts.title')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.shortcuts.map((shortcut) => (
              <li key={shortcut.key} className="min-w-0">
                <Link
                  href={shortcut.href}
                  className="flex h-full flex-col gap-1 rounded-lg border border-border bg-card p-6 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                >
                  <span className="text-sm font-medium leading-normal">{t(`shortcuts.${shortcut.key}.title`)}</span>
                  <span className="text-sm leading-normal text-muted-foreground">{t(`shortcuts.${shortcut.key}.description`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}

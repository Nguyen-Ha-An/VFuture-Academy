import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { SupportTable } from '../support/SupportTable';

import { routes } from '@/lib/routes';
import { intlLocale, rankDelta } from '@/features/workspace-ui/format';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Segmented } from '@/features/workspace-ui/ui/Segmented';
import { Delta, EmptyBench, Meta, StateTag } from '@/features/workspace-ui/ui/primitives';
import { leaderboardRows, type LeaderboardEntry, type LeaderboardViewer } from './leaderboard-rows';

export type LeaderboardScopeValue = 'global' | 'branch';

/** Page head: kicker with the ISO week, h1, scope segmented control and the weekly reset time. */
export function LeaderboardBenchHead({ scope, week }: { scope: LeaderboardScopeValue; week: number }) {
  const t = useTranslations('leaderboard');
  const b = useTranslations('bench.profile.leaderboard');
  return <PageHeader className="canvas-page vf-anchor-in" kicker={b('kicker', { week: String(week).padStart(2, '0') })} title={t('title')} lead={t('description')}>
    <div className="canvas-toolbar vf-page-head-row">
      <Segmented label={t('scopeLabel')} items={(['global', 'branch'] as const).map(value => ({ key: value, label: t(value), href: routes.learner.leaderboard({ scope: value }), current: scope === value }))} />
      <Meta as="span">{b('resets')}</Meta>
    </div>
  </PageHeader>;
}

export type LeaderboardBoardViewProps = {
  entries: readonly LeaderboardEntry[];
  viewer: LeaderboardViewer;
  /** Branch scope requested, but the learner has no branch. */
  noBranch?: boolean;
  /** Last week's rank by handle; when present a rank-change column renders. */
  previousRanks?: Readonly<Record<string, number>>;
};

/**
 * The weekly board as a spec table, with week-over-week rank change when last week's board loaded.
 * No per-row sparkline: the leaderboard RPC returns one weekly total per learner, not daily points.
 */
export function LeaderboardBoardView({ entries, viewer, noBranch, previousRanks }: LeaderboardBoardViewProps) {
  const t = useTranslations('leaderboard');
  const b = useTranslations('bench.profile.leaderboard');
  const certificatesT = useTranslations('bench.profile.certificates');
  const locale = useLocale();
  if (noBranch) return <div className="canvas-panel canvas-empty vf-block"><EmptyBench title={t('noBranch')} /></div>;
  const slice = leaderboardRows(entries, viewer);
  if (slice.empty) return <div className="canvas-panel canvas-empty vf-block"><EmptyBench title={b('emptyTitle')} description={b('emptyBody')} action={<Link className="vf-btn" href={routes.learner.courses()}>{certificatesT('browse')} <span aria-hidden="true">→</span></Link>} /></div>;
  const number = new Intl.NumberFormat(intlLocale(locale));

  return <section aria-label={b('board')} className="canvas-panel vf-block p-4 sm:p-6">
    <div className="vf-block-head"><Meta as="span">{b('learners', { count: entries.length })}</Meta>{slice.viewerRank ? <Meta as="span">{b('yourRank', { rank: slice.viewerRank })}</Meta> : null}</div>
    <SupportTable caption={t('caption')} columns={[
      { key: 'rank', label: t('rank') }, { key: 'learner', label: t('learner') }, { key: 'points', label: t('points') },
      ...(previousRanks ? [{ key: 'change', label: b('change') }] : []),
    ]} rows={slice.rows.map((row, index) => {
      if (row.kind === 'gap') return { key: `gap-${index}`, cells: [<span key="gap" aria-label={b('gap')}>…</span>, '', '', ...(previousRanks ? [''] : [])] };
      if (row.kind === 'unranked') return { key: 'viewer-unranked', current: true, cells: [
        '—', <div key="name"><span className="vf-lb-name">{row.reason === 'no-xp' ? b('noXp') : b('private')}</span><span className="vf-sub">{row.reason === 'no-xp' ? b('enter') : b('privateHint')}</span></div>,
        row.reason === 'no-xp' ? '0' : '—', ...(previousRanks ? ['—'] : []),
      ] };
      const { entry } = row;
      const delta = rankDelta(entry.rank, entry.handle ? previousRanks?.[entry.handle] : null);
      return { key: `${entry.rank}:${entry.handle ?? entry.displayName}`, current: row.viewer, cells: [
        `#${entry.rank}`,
        <div key="name"><span className="vf-lb-name">{entry.displayName || entry.handle || t('anonymous')}{row.viewer ? <StateTag tone="signal">{b('you')}</StateTag> : null}</span>{entry.handle && entry.displayName ? <span className="vf-sub">@{entry.handle}</span> : null}</div>,
        number.format(entry.points),
        ...(previousRanks ? [<span key="change"><Delta text={delta.tone === 'new' ? b('new') : delta.text} tone={delta.tone} /><span className="sr-only">{b('changeHint')}</span></span>] : []),
      ] };
    })} />
  </section>;
}

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

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
  return <PageHeader className="vf-anchor-in" kicker={b('kicker', { week: String(week).padStart(2, '0') })} title={t('title')} lead={t('description')}>
    <div className="vf-page-head-row">
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
  if (noBranch) return <div className="vf-block"><EmptyBench title={t('noBranch')} /></div>;
  const slice = leaderboardRows(entries, viewer);
  if (slice.empty) return <div className="vf-block"><EmptyBench title={b('emptyTitle')} description={b('emptyBody')} action={<Link className="vf-btn" href={routes.learner.courses()}>{certificatesT('browse')} <span aria-hidden="true">→</span></Link>} /></div>;
  const number = new Intl.NumberFormat(intlLocale(locale));

  return <section aria-label={b('board')} className="vf-block">
    <div className="vf-block-head"><Meta as="span">{b('learners', { count: entries.length })}</Meta>{slice.viewerRank ? <Meta as="span">{b('yourRank', { rank: slice.viewerRank })}</Meta> : null}</div>
    <div className="vf-scroll-x">
      <table className="vf-spec">
        <caption className="sr-only">{t('caption')}</caption>
        <thead><tr><th scope="col">{t('rank')}</th><th scope="col">{t('learner')}</th><th scope="col" className="vf-num">{t('points')}</th>{previousRanks ? <th scope="col" className="vf-num">{b('change')}</th> : null}</tr></thead>
        <tbody>{slice.rows.map((row, index): ReactNode => {
          if (row.kind === 'gap') return <tr key={`gap-${index}`} data-gap=""><td colSpan={previousRanks ? 4 : 3}><span aria-hidden="true">· · ·</span><span className="sr-only">{b('gap')}</span></td></tr>;
          if (row.kind === 'unranked') return <tr key="viewer-unranked" aria-current="true">
            <td className="vf-mono">—</td>
            <td><span className="vf-lb-name">{row.reason === 'no-xp' ? b('noXp') : b('private')}</span><span className="vf-sub">{row.reason === 'no-xp' ? b('enter') : b('privateHint')}</span></td>
            <td className="vf-num">{row.reason === 'no-xp' ? '0' : '—'}</td>
            {previousRanks ? <td className="vf-num">—</td> : null}
          </tr>;
          const { entry } = row;
          return <tr key={`${entry.rank}:${entry.handle ?? entry.displayName}`} aria-current={row.viewer ? 'true' : undefined}>
            <td className="vf-mono">#{entry.rank}</td>
            <td><span className="vf-lb-name">{entry.displayName || entry.handle || t('anonymous')}{row.viewer ? <StateTag tone="signal">{b('you')}</StateTag> : null}</span>{entry.handle && entry.displayName ? <span className="vf-sub">@{entry.handle}</span> : null}</td>
            <td className="vf-num">{number.format(entry.points)}</td>
            {previousRanks ? (() => { const delta = rankDelta(entry.rank, entry.handle ? previousRanks[entry.handle] : null); return <td className="vf-num"><Delta text={delta.tone === 'new' ? b('new') : delta.text} tone={delta.tone} /><span className="sr-only">{b('changeHint')}</span></td>; })() : null}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

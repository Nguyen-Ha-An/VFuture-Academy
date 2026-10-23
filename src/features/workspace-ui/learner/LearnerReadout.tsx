import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { formatDelta, rankDelta } from '../format';
import { Delta, LevelScale, ReadoutCell, Sparkline } from '../ui/primitives';
import type { ExamDeadline } from './model';

/** A readout cell's data: each cell loads and fails on its own (spec 4.12 "per-cell fault"). */
export type Reading<T> = { ok: true; value: T } | { ok: false };

export type ReadoutXp = { week: number; previous: number; values: number[] };
export type ReadoutRank = { rank: number; total: number; previousRank?: number | null } | { rank: null; reason: 'no-branch' | 'no-xp' };
export type ReadoutSkill = { id: string; name: string; level: 1 | 2 | 3; levelKey: 'exposed' | 'applied' | 'demonstrated' };

const number = (value: number, locale: string) => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 0 }).format(value);

function Fault({ label }: { label: string }) {
  const shared = useTranslations('bench.shared');
  return <span className="vf-meta vf-l-cell-fault" role="status">{shared('unavailable', { label })}</span>;
}

/** Readout column: XP this week, next deadline, branch rank, top 3 skills. */
export function LearnerReadout({ xp, deadline, deadlineLabel, rank, skills, locale }: { xp: Reading<ReadoutXp>; deadline: ExamDeadline | null; deadlineLabel?: string; rank: Reading<ReadoutRank>; skills: Reading<ReadoutSkill[]>; locale: string }) {
  const t = useTranslations('bench.learner.readout');
  const shared = useTranslations('bench.shared');
  const delta = xp.ok ? formatDelta(xp.value.week, xp.value.previous) : null;
  return <>
    <ReadoutCell label={t('xp')} detail={xp.ok ? t('xpDetail') : undefined}>
      {xp.ok ? <>
        <span className="vf-readout-big">{number(xp.value.week, locale)} <small><Delta text={delta!.tone === 'new' ? shared('new') : delta!.text} tone={delta!.tone} /></small></span>
        <Sparkline values={xp.value.values} label={t('xpSpark', { total: number(xp.value.values.reduce((sum, value) => sum + value, 0), locale), max: number(Math.max(0, ...xp.value.values), locale), today: number(xp.value.values[xp.value.values.length - 1] ?? 0, locale) })} />
      </> : <Fault label={t('xp')} />}
    </ReadoutCell>
    <ReadoutCell label={t('deadline')} detail={deadline ? [deadlineLabel, deadline.stamp].filter(Boolean).join(' · ') : t('deadlineNone')}>
      {deadline
        ? <span className="vf-readout-big" data-tone="pending"><span className="sr-only">{t(deadline.kind === 'opens' ? 'opens' : 'closes')} </span>{deadline.countdown}</span>
        : <span className="vf-readout-big">—</span>}
    </ReadoutCell>
    <ReadoutCell label={t('rank')}>
      {rank.ok ? rank.value.rank !== null
        ? <>
          <span className="vf-readout-big">#{rank.value.rank} <small>{t('rankOf', { total: rank.value.total })}</small></span>
          {rank.value.previousRank !== undefined ? (() => { const delta = rankDelta(rank.value.rank, rank.value.previousRank); return <span className="vf-meta"><Delta text={delta.tone === 'new' ? t('rankNew') : delta.text} tone={delta.tone} /> {delta.tone === 'new' ? null : t('rankSinceLastWeek')}</span>; })() : null}
          <Link href={routes.learner.leaderboard({ scope: 'branch' })} className="vf-l-link">{t('openLeaderboard')}<span className="vf-l-arrow" aria-hidden="true"> →</span></Link>
        </>
        : <>
          <span className="vf-readout-big">—</span>
          <span className="vf-meta">{t(rank.value.reason === 'no-branch' ? 'rankNoBranch' : 'rankNone')}</span>
          <Link href={routes.learner.leaderboard()} className="vf-l-link">{t('openLeaderboard')}<span className="vf-l-arrow" aria-hidden="true"> →</span></Link>
        </>
        : <Fault label={t('rank')} />}
    </ReadoutCell>
    <ReadoutCell label={t('skills')}>
      {skills.ok ? skills.value.length
        ? <ul className="vf-l-skills">{skills.value.map(skill => <li key={skill.id}>
          <span className="min-w-0 break-words">{skill.name}</span>
          <span className="vf-meta">L{skill.level}</span>
          <LevelScale level={skill.level} max={3} label={t('skillLevel', { skill: skill.name, level: skill.level, max: 3, name: t(`levels.${skill.levelKey}`) })} />
        </li>)}</ul>
        : <span className="vf-meta">{t('skillsEmpty')}</span>
        : <Fault label={t('skills')} />}
    </ReadoutCell>
  </>;
}

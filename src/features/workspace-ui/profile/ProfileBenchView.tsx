import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { ProfileSettings as LearnerProfileSettings } from '@/features/learner/ui/ProfileSettings';
import type { OwnerCompletedCourse, ProfileSettings as ProfileSettingsValue, PublicProject } from '@/features/profile/service';
import { ProfileSettings } from '@/features/profile/ui/ProfileSettings';
import type { PassportSkill } from '@/features/skills/service';
import { ictDate, intlLocale } from '@/features/workspace-ui/format';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { EmptyBench, LevelScale, Meta, StateTag } from '@/features/workspace-ui/ui/primitives';
import { SectionBoundary } from '@/features/workspace-ui/ui/SectionBoundary';
import { routes } from '@/lib/routes';
import { CalibrationCertificate, type CalibrationCertificateData } from './CalibrationCertificate';
import { ProfileHandle } from './ProfileHandle';

/** Mirrors SKILL_LEVELS in skills/service (server-only), lowest first. */
const SKILL_LEVELS = ['exposed', 'applied', 'demonstrated'] as const;

export type ProfileBenchViewProps = {
  locale: Locale;
  profile: { displayName: string; handle: string | null; locale: Locale; avatarUrl: string | null };
  branch: string | null;
  settings: ProfileSettingsValue;
  skills: PassportSkill[];
  completedCourses: OwnerCompletedCourse[];
  projects: PublicProject[];
  certificates: CalibrationCertificateData[];
  xpTotal: number;
  /** Trace Rail slot, streamed behind its own boundary. */
  trace?: ReactNode;
};

function titleOf(value: string | L10nString, locale: Locale) {
  return typeof value === 'string' ? value : value[locale] ?? value.vi ?? value.en ?? '';
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

/**
 * Bench rendering of /app/profile. Section order is a test contract (profile-page-ui.test.tsx):
 * identity, skills, completed courses, projects, certificates, total XP, public settings.
 */
export function ProfileBenchView(props: ProfileBenchViewProps) {
  const { locale, profile, settings } = props;
  const t = useTranslations('bench.profile');
  const legacy = useTranslations('learner.profile');
  const publicT = useTranslations('profile.public');
  const name = profile.displayName || legacy('title');
  const handle = settings.handle ?? profile.handle;

  return <div className="vf-profile">
    {props.trace ? <SectionBoundary label={t('traceLabel')}><div className="vf-profile-trace"><Suspense fallback={<div className="vf-trace vf-sweep" aria-hidden="true" />}>{props.trace}</Suspense></div></SectionBoundary> : null}
    <section aria-labelledby="profile-title">
      <PageHeader className="vf-anchor-in" kicker={t('kicker')} title={name} titleId="profile-title" meta={[
        <ProfileHandle key="handle" handle={handle} />,
        props.branch ? t('branch', { branch: props.branch }) : t('independent'),
        settings.profilePublic && handle
          ? <Link key="public" href={routes.public.profile(handle)}>{t('publicProfile')} <span aria-hidden="true">→</span></Link>
          : t('publicOff'),
      ]} />
      <div className="vf-profile-identity"><LearnerProfileSettings displayName={profile.displayName} locale={profile.locale} initialAvatarUrl={profile.avatarUrl} /></div>
    </section>

    <SectionBoundary label={t('skills.label')}><SkillsBlock skills={props.skills} locale={locale} /></SectionBoundary>

    <SectionBoundary label={t('completed.label')}>
      <section aria-labelledby="completed-courses-heading" className="vf-block">
        <div className="vf-block-head"><h2 id="completed-courses-heading" className="vf-h3">{publicT('completedCourses')}</h2>{props.completedCourses.length ? <Meta as="span">{props.completedCourses.length}</Meta> : null}</div>
        {props.completedCourses.length ? <div className="vf-scroll-x"><table className="vf-spec" data-stack="">
          <thead><tr><th scope="col">{t('completed.course')}</th><th scope="col">{t('completed.state')}</th><th scope="col" className="vf-num">{t('completed.date')}</th></tr></thead>
          <tbody>{props.completedCourses.map((course) => {
            const title = titleOf(course.title, locale);
            return <tr key={course.id}>
              <td data-slot="lead">{course.currentDestinationAvailable ? <Link href={routes.learner.course(course.id)}>{title}</Link> : <span className="font-medium">{title}</span>}</td>
              <td data-slot="status"><StateTag tone="signal">{t('completed.inSpec')}</StateTag></td>
              <td data-slot="trail" className="vf-num vf-meta"><time dateTime={course.completedAt}>{ictDate(new Date(course.completedAt))}</time></td>
            </tr>;
          })}</tbody>
        </table></div> : <EmptyBench title={publicT('empty')} />}
      </section>
    </SectionBoundary>

    <SectionBoundary label={t('projects.label')}>
      <section aria-labelledby="projects-heading" className="vf-block">
        <div className="vf-block-head"><h2 id="projects-heading" className="vf-h3">{publicT('projects')}</h2></div>
        {props.projects.length ? <ul className="vf-hairlist">{props.projects.map((project) => <li key={project.id}>
          <Link className="vf-hair-link" href={routes.learner.project(project.id)}><span>{titleOf(project.title, locale)}</span><span aria-hidden="true" className="vf-meta">→</span></Link>
          {titleOf(project.summary, locale) ? <Meta>{titleOf(project.summary, locale)}</Meta> : null}
        </li>)}</ul> : <EmptyBench title={publicT('empty')} />}
      </section>
    </SectionBoundary>

    <SectionBoundary label={t('certificates.label')}>
      <section aria-labelledby="certificates-heading" className="vf-block">
        <div className="vf-block-head"><h2 id="certificates-heading" className="vf-h3">{legacy('certificates')}</h2>{props.certificates.length ? <Meta as="span">{t('certificates.count', { count: props.certificates.length })}</Meta> : null}</div>
        {props.certificates.length
          ? <ul className="vf-cert-list">{props.certificates.map((certificate) => <li key={certificate.id}><CalibrationCertificate certificate={certificate} /></li>)}</ul>
          : <EmptyBench kicker={t('certificates.emptyKicker')} title={legacy('noCertificates')} description={t('certificates.emptyBody')} action={<Link className="vf-btn" href={routes.learner.courses()}>{t('certificates.browse')} <span aria-hidden="true">→</span></Link>} />}
      </section>
    </SectionBoundary>

    <SectionBoundary label={t('xp.label')}>
      <section aria-labelledby="xp-heading" className="vf-block">
        <div className="vf-block-head"><h2 id="xp-heading" className="vf-h3">{legacy('xp')}</h2></div>
        {/* No weekly XP series exists yet, so the 12-week sparkline is omitted and only the total renders. */}
        <p className="vf-xp-total m-0"><span className="vf-readout-big">{new Intl.NumberFormat(intlLocale(locale)).format(props.xpTotal)}</span> <span className="vf-meta">{t('xp.unit')}</span></p>
      </section>
    </SectionBoundary>

    <div className="vf-block"><ProfileSettings initial={settings} /></div>
  </div>;
}

function SkillsBlock({ skills, locale }: { skills: PassportSkill[]; locale: Locale }) {
  const t = useTranslations('skills');
  const bench = useTranslations('bench.profile');
  return <section aria-labelledby="skills-passport-heading" className="vf-block">
    <div className="vf-block-head"><h2 id="skills-passport-heading" className="vf-h3">{t('title')}</h2></div>
    <p className="mt-0 mb-4 text-muted-foreground">{t('description')}</p>
    {skills.length ? <ul className="vf-hairlist">{skills.map((skill) => {
      const name = resolveL10nString(skill.name, locale, 'vi');
      const levelName = t(`levels.${skill.level}`);
      const value = SKILL_LEVELS.indexOf(skill.level) + 1;
      return <li key={skill.id} className="vf-skill">
        <div className="min-w-0"><h3 className="vf-skill-name">{name}</h3></div>
        <LevelScale level={value} max={SKILL_LEVELS.length} label={bench('skills.level', { name, level: levelName, value, max: SKILL_LEVELS.length })} />
        <StateTag tone={skill.level === 'demonstrated' ? 'signal' : 'neutral'}>{levelName}</StateTag>
        {skill.evidence.length ? <details>
          <summary>{t('evidenceCount', { count: skill.evidence.length })}</summary>
          <ul>{skill.evidence.map((evidence) => {
            const label = t(`evidenceTypes.${evidence.evidenceType}`);
            const content = <><span>{label}</span><time className="vf-meta" dateTime={evidence.createdAt}>{t('achievedOn', { date: formatDate(evidence.createdAt, locale) })}</time></>;
            return <li key={evidence.id}>{evidence.href
              ? <Link href={evidence.href} aria-label={t('openEvidence', { type: label, skill: name })}>{content}</Link>
              : <div className="vf-evidence">{content}</div>}</li>;
          })}</ul>
        </details> : null}
      </li>;
    })}</ul> : <EmptyBench title={t('empty')} />}
  </section>;
}

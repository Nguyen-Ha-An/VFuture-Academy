import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { resolveL10nString, type Locale } from '@/content-engine';
import { Badge } from '@/components/ui/classic';
import type { PublicProfile } from '@/features/profile/service';
import { routes } from '@/lib/routes';

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

export function PublicProfileView({ profile, locale }: { profile: PublicProfile; locale: Locale }) {
  const t = useTranslations('profile.public');
  const skills = useTranslations('skills');
  const localized = (value: Parameters<typeof resolveL10nString>[0]) => resolveL10nString(value, locale, 'vi');

  const sections = [
    {
      id: 'public-skills',
      title: t('skills'),
      content: profile.skills.length ? (
        <ul className="flex flex-wrap gap-3">
          {profile.skills.map((skill) => (
            <li key={skill.id} className="rounded-md border border-border p-4">
              <p className="font-medium">{localized(skill.name)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge>{skills(`levels.${skill.level}`)}</Badge>
                <span className="text-xs text-muted-foreground">{t('evidenceCount', { count: skill.evidenceCount })}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: 'completed-courses', title: t('completedCourses'), content: profile.completedCourses.length ? <ul className="divide-y divide-border">{profile.completedCourses.map((course) => <li key={course.id} className="py-4"><Link href={routes.public.course(course.id)} className="rounded-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{localized(course.title)}</Link><p className="mt-1 text-xs text-muted-foreground">{t('completedOn', { date: formatDate(course.completedAt, locale) })}</p></li>)}</ul> : null,
    },
    {
      id: 'showcased-projects',
      title: t('projects'),
      content: profile.projects.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {profile.projects.map((project) => {
            const title = localized(project.title);
            return (
              <li key={project.id} className="rounded-md border border-border p-4">
                <Link href={routes.public.project(project.id)} aria-label={t('openProject', { project: title })} className="font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{title}</Link>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{localized(project.summary)}</p>
                {project.outputLinks.length ? (
                  <nav aria-label={t('outputs')} className="mt-3 flex flex-wrap gap-3">
                    {project.outputLinks.map((link) => (
                      <a key={link.url} href={link.url} rel="nofollow ugc noopener noreferrer" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{link.label ?? link.url}</a>
                    ))}
                  </nav>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null,
    },
    {
      id: 'certificates', title: t('certificates'), content: profile.certificates.length ? <ul className="space-y-3">{profile.certificates.map((certificate) => { const course = localized(certificate.title); return <li key={certificate.verificationCode} className="rounded-md border border-border p-4"><Link href={certificate.href} aria-label={t('verifyCertificate', { course })} className="rounded-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{course}</Link><p className="mt-1 text-xs text-muted-foreground">{t('issuedOn', { date: formatDate(certificate.issuedAt, locale) })}</p></li>; })}</ul> : null,
    },
  ];

  return (
    <article>
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">{t('eyebrow')}</p>
          <div className="mt-5 flex items-center gap-5">
            <div aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{profile.displayName}</h1>
              <p className="mt-2 font-mono text-sm text-muted-foreground">{t('handle', { handle: profile.handle })}</p>
            </div>
          </div>
          <p className="mt-7 text-sm text-muted-foreground"><span className="font-medium text-foreground">{t('branch')}:</span> {profile.branch?.name ?? t('independent')}</p>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-12 px-5 py-14 sm:px-8 sm:py-20">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`} className="text-2xl font-semibold tracking-tight">{section.title}</h2>
            <div className="mt-5">{section.content ?? <p className="text-sm text-muted-foreground">{t('empty')}</p>}</div>
          </section>
        ))}
      </div>
    </article>
  );
}

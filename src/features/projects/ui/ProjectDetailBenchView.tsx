import Image from 'next/image';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/content-engine/schema/common';
import type { ProjectDetail } from '@/features/projects/service';
import { mediaHref } from '@/features/media/urls';
import { routes } from '@/lib/routes';
import { DetailPage } from '@/features/workspace-ui/learner/DetailPage';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card, StateTag } from '@/features/workspace-ui/ui/primitives';
import { localizedPart } from './form-utils';
import { ProjectInterestButton } from './ProjectInterestButton';
import { type ProjectBenchFilter, readableProjectId } from './project-bench-model';

/**
 * Learner project detail on DetailPage: cover, outputs and related courses in the main column, the
 * interest ActionPanel, and team, skills (resolved names) and the owner-only interest list aside.
 * `notice` (the proposal-submitted confirmation) sits under the page header.
 */
export function ProjectDetailBenchView({ project, locale, filter, skillNames, notice }: { project: ProjectDetail; locale: Locale; filter: ProjectBenchFilter; skillNames: ReadonlyMap<string, string>; notice?: ReactNode }) {
  const t = useTranslations('build');
  const learner = useTranslations('learner');
  const focus = useTranslations('learner.focus');
  const name = (value: typeof project.title) => localizedPart(value, locale) || localizedPart(value, locale === 'vi' ? 'en' : 'vi');
  const title = name(project.title);
  const summary = name(project.summary);

  return <DetailPage
    header={<PageHeader
      crumbs={[{ label: focus('explore'), href: routes.learner.explore() }, { label: focus('projects'), href: routes.learner.projects(filter) }, { label: title }]}
      kicker={learner('directory.kickers.projects')}
      tags={<><StateTag tone={project.approved ? project.status === 'completed' || project.status === 'showcased' ? 'signal' : 'neutral' : 'pending'}>{t(`status.${project.status}`)}</StateTag>{!project.approved ? <StateTag tone="pending">{t('card.pending')}</StateTag> : null}</>}
      title={title}
      lead={summary}
    />}
    notice={notice}
    action={{
      title: t('detail.nextStep'),
      titleId: 'project-next-step',
      body: <p>{project.canExpressInterest ? t('detail.interestNote') : t('detail.pendingNote')}</p>,
      action: project.canExpressInterest ? <ProjectInterestButton projectId={project.id} initialInterested={project.interested} /> : null,
    }}
    asideLabel={t('detail.relatedWork')}
    aside={<>
      <Card title={t('detail.team')} titleId="project-team" actions={<span className="vf-meta">{project.members.length}</span>}>
        {project.members.length
          ? <ul className="vf-l-rows">{project.members.map(member => <li key={member.userId} className="vf-l-row"><span>{member.displayName ?? member.handle ?? t('detail.memberFallback')}</span><span className="vf-meta">{t(`detail.roles.${member.role}`)}</span></li>)}</ul>
          : <p className="vf-l-prose vf-l-muted">{t('detail.teamEmpty')}</p>}
      </Card>
      <Card title={t('detail.skills')} titleId="project-skills" actions={<span className="vf-meta">{project.skills.length}</span>}>
        {project.skills.length
          ? <ul className="vf-l-tags">{project.skills.map(skill => <li key={skill}><StateTag plain>{skillNames.get(skill) || readableProjectId(skill)}</StateTag></li>)}</ul>
          : <p className="vf-l-prose vf-l-muted">{t('detail.skillsEmpty')}</p>}
      </Card>
      {project.interestList ? <Card title={t('detail.interestedPeople')} titleId="project-interest-list" actions={<span className="vf-meta">{project.interestList.length}</span>}>
        <p className="vf-l-prose vf-l-muted">{t('detail.ownerNote')}</p>
        <ul className="vf-l-rows">{project.interestList.map(person => <li key={person.userId} className="vf-l-row">{person.displayName ?? person.handle ?? t('detail.memberFallback')}</li>)}</ul>
      </Card> : null}
    </>}
  >
    {project.coverAssetId ? <div className="vf-l-cover"><Image src={mediaHref(project.coverAssetId)} alt={title} width={960} height={480} unoptimized /></div> : null}
    <Card title={t('detail.outputs')} titleId="project-outputs" flush={project.outputLinks.length > 0}>
      {project.outputLinks.length
        ? <ul className="vf-l-rows">{project.outputLinks.map(output => <li key={output.url}><a href={output.url} target="_blank" rel="noreferrer" className="vf-l-row vf-l-row-link"><span>{name(output.label)}</span><span aria-hidden="true" className="vf-l-row-arrow">↗</span></a></li>)}</ul>
        : <p className="vf-l-prose vf-l-muted">{t('detail.noOutputs')}</p>}
    </Card>
    {project.relatedCourses.length ? <Card title={t('detail.courses')} titleId="project-courses" flush>
      <ul className="vf-l-rows">{project.relatedCourses.map(course => <li key={course.id}><Link href={routes.learner.course(course.id)} className="vf-l-row vf-l-row-link"><span>{name(course.title)}</span><span aria-hidden="true" className="vf-l-row-arrow">→</span></Link></li>)}</ul>
    </Card> : null}
  </DetailPage>;
}

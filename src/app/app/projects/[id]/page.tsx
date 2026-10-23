import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';

import type { Locale } from '@/content-engine/schema/common';
import { listCatalog } from '@/features/catalog/service';
import { projectListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { getProject } from '@/features/projects/service';
import { ProjectDetailBenchView } from '@/features/projects/ui/ProjectDetailBenchView';
import { ProposalSubmittedNotice } from '@/features/projects/ui/ProposalSubmittedNotice';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

async function visibleProject(userId: string, id: string) {
  try {
    return await getProject(userId, id);
  } catch (error) {
    if ((error instanceof ApiError && error.status === 404) || error instanceof z.ZodError) notFound();
    throw error;
  }
}

export default async function BuildDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<LearnerListSearchParams> }) {
  const [{ id }, listParams, user, locale] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<LearnerListSearchParams>({}),
    requireUser(),
    getLocale() as Promise<Locale>,
  ]);
  const listContext = projectListContext(listParams).query;
  const project = await visibleProject(user.id, id);
  const catalog = project.skills.length
    ? await listCatalog({ userId: user.id, roles: [] }, locale).catch(() => [])
    : [];
  const skillNames = new Map(catalog.flatMap(course => course.skills.map(skill => [skill.id, skill.name] as const)));
  // `?submitted=1` comes from the proposal form's redirect; the notice strips it again.
  const submitted = listParams.submitted === '1';
  // The notice always renders (it hides itself) so its state survives the replace's re-render.
  return <ProjectDetailBenchView
    project={project}
    locale={locale}
    filter={listContext}
    skillNames={skillNames}
    notice={<ProposalSubmittedNotice show={submitted} cleanHref={routes.learner.project(project.id, listContext)} />}
  />;
}

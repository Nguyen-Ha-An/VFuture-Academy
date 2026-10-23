import { getLocale } from 'next-intl/server';

import type { Locale } from '@/content-engine/schema/common';
import { listCatalog } from '@/features/catalog/service';
import { listProjects } from '@/features/projects/service';
import { projectListContext, type LearnerListSearchParams } from '@/features/learner/list-context';
import { ProjectsBenchView } from '@/features/projects/ui/ProjectsBenchView';
import { filterBenchProjects, projectBenchOptions } from '@/features/projects/ui/project-bench-model';
import { requireUser } from '@/lib/auth';

export default async function BuildPage({ searchParams }: { searchParams: Promise<LearnerListSearchParams> }) {
  const user = await requireUser();
  const [params, locale] = await Promise.all([searchParams, getLocale() as Promise<Locale>]);
  const { query: listContext } = projectListContext(params);
  const visibleProjects = await listProjects(user.id);
  const catalog = visibleProjects.some(project => project.skills.length || project.courseIds.length)
    ? await listCatalog({ userId: user.id, roles: [] }, locale).catch(() => [])
    : [];
  const options = projectBenchOptions(visibleProjects, catalog, locale);
  return <ProjectsBenchView
    projects={filterBenchProjects(visibleProjects, listContext)}
    locale={locale}
    filter={listContext}
    skills={options.skills}
    courses={options.courses}
  />;
}

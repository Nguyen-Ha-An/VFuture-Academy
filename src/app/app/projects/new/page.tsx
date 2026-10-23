import { useTranslations } from 'next-intl';
import { getLocale } from 'next-intl/server';

import type { Locale } from '@/content-engine/schema/common';
import { listCatalog } from '@/features/catalog/service';
import { ProjectProposalForm } from '@/features/projects/ui/ProjectProposalForm';
import { projectProposalOptions, type ProjectFilterOption } from '@/features/projects/ui/project-bench-model';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card } from '@/features/workspace-ui/ui/primitives';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

function NewProjectView({ locale, skills, courses }: { locale: Locale; skills: ProjectFilterOption[]; courses: ProjectFilterOption[] }) {
  const t = useTranslations('build.proposal');
  const section = useTranslations('learner.focus');
  const learner = useTranslations('learner');
  return <div className="vf-projects-new">
    <PageHeader
      crumbs={[{ label: section('explore'), href: routes.learner.explore() }, { label: section('projects'), href: routes.learner.projects() }, { label: learner('directory.crumbs.newProposal') }]}
      kicker={learner('directory.kickers.projectsNew')}
      title={t('title')}
      lead={t('description')}
    />
    {/* One card, at most 760px wide (learner.css .vf-proposal-card); the form carries its own name. */}
    <Card as="div" className="vf-proposal-card">
      <ProjectProposalForm locale={locale} skillOptions={skills} courseOptions={courses} />
    </Card>
  </div>;
}

export default async function NewProjectPage() {
  const user = await requireUser();
  const locale = await getLocale() as Locale;
  // Options come from the catalog, not from existing projects, so the first proposal can still link courses.
  const catalog = await listCatalog({ userId: user.id, roles: [] }, locale).catch(() => []);
  const options = projectProposalOptions(catalog, locale);
  return <NewProjectView locale={locale} skills={options.skills} courses={options.courses} />;
}

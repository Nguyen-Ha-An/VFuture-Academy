import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/content-engine/schema/common';
import type { ProjectListEntry } from '@/features/projects/service';
import { routes } from '@/lib/routes';
import { filterStateKey } from '@/lib/search-params';
import { projectFilterChips, type ChipTranslate } from '@/features/workspace-ui/learner/directory/chips';
import { DirectoryPage } from '@/features/workspace-ui/learner/directory/DirectoryPage';
import { DirectoryTable, type DirectoryRow } from '@/features/workspace-ui/learner/directory/DirectoryTable';
import { FilterLink } from '@/features/workspace-ui/learner/directory/FilterBar';
import { BenchState } from '@/features/workspace-ui/ui/BenchState';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { StateTag } from '@/features/workspace-ui/ui/primitives';
import { PROJECT_STATUSES } from '@/features/projects/service';
import { localizedPart } from './form-utils';
import { type ProjectBenchFilter, type ProjectFilterOption, readableProjectId } from './project-bench-model';

const relationships = ['proposal', 'participation', 'showcase'] as const;

function ProjectTable({ projects, locale, filter, skillLabels, caption }: {
  projects: ProjectListEntry[];
  locale: Locale;
  filter: ProjectBenchFilter;
  skillLabels: Map<string, string>;
  caption: string;
}) {
  const t = useTranslations('build');
  const directory = useTranslations('learner.directory');
  const rows = projects.map((project): DirectoryRow => {
    const title = localizedPart(project.title, locale) || localizedPart(project.title, locale === 'vi' ? 'en' : 'vi');
    const summary = localizedPart(project.summary, locale) || localizedPart(project.summary, locale === 'vi' ? 'en' : 'vi');
    return {
      id: project.id,
      lead: <StateTag tone={project.approved ? project.status === 'completed' || project.status === 'showcased' ? 'signal' : 'neutral' : 'pending'}>{t(`status.${project.status}`)}</StateTag>,
      title,
      summary: summary || undefined,
      meta: [
        ...(!project.approved ? [<StateTag key="pending" tone="pending">{t('card.pending')}</StateTag>] : []),
        ...project.skills.slice(0, 3).map(skill => skillLabels.get(skill) || readableProjectId(skill)),
      ],
      href: routes.learner.project(project.id, filter),
      cta: directory('open'),
      ctaLabel: t('card.open', { project: title }),
    };
  });
  return <DirectoryTable caption={caption} columns={{ lead: t('filters.status'), title: t('card.project'), cta: directory('columns.next') }} rows={rows} />;
}

export function ProjectsBenchView({ projects, locale, filter, skills, courses }: {
  projects: ProjectListEntry[];
  locale: Locale;
  filter: ProjectBenchFilter;
  skills: ProjectFilterOption[];
  courses: ProjectFilterOption[];
}) {
  const t = useTranslations('build');
  const learner = useTranslations('learner');
  const focus = useTranslations('learner.focus');
  const activeCount = Object.values(filter).filter(Boolean).length;
  const directory = useTranslations('learner.directory');
  const skillLabels = new Map(skills.map(skill => [skill.id, skill.label]));
  const displayed = relationships.map(relationship => ({ relationship, items: projects.filter(project => project.relationship === relationship) }));
  // A selected id the options do not list (a stale link) still shows as selected.
  const selectOptions = (options: ProjectFilterOption[], selected: string | undefined) => (selected && !options.some(option => option.id === selected)
    ? [...options, { id: selected, label: readableProjectId(selected) }]
    : options).map(option => ({ value: option.id, label: option.label }));
  const skillOptions = selectOptions(skills, filter.skill);
  const courseOptions = selectOptions(courses, filter.course);
  // Chips name a filter exactly as its select shows it, including a stale id.
  const optionLabels = (options: ReadonlyArray<{ value: string; label: string }>) => new Map(options.map(option => [option.value, option.label]));

  return <div className="vf-projects-bench vf-l-directory">
    <PageHeader
      crumbs={[{ label: focus('explore'), href: routes.learner.explore() }, { label: focus('projects') }]}
      kicker={learner('directory.kickers.projects')}
      title={t('title')}
      lead={t('description')}
      actions={<Link href={routes.learner.newProject()} className="vf-btn vf-btn-primary vf-btn-lg">{t('openProposal')}</Link>}
    />
    <DirectoryPage
      header={null}
      filters={{
        label: t('filters.label'),
        summary: activeCount ? directory('filtersSummary', { count: activeCount }) : directory('filters'),
        fields: [
          { kind: 'select', name: 'status', label: t('filters.status'), value: filter.status, allLabel: t('filters.allStatuses'), options: PROJECT_STATUSES.map(status => ({ value: status, label: t(`status.${status}`) })) },
          { kind: 'select', name: 'skill', label: t('filters.skillName'), value: filter.skill, allLabel: t('filters.allSkills'), options: skillOptions },
          { kind: 'select', name: 'course', label: t('filters.courseName'), value: filter.course, allLabel: t('filters.allCourses'), options: courseOptions },
        ],
        stateKey: filterStateKey(filter),
        activeCount,
        clearHref: routes.learner.projects(),
        columns: 3,
        resultsId: 'project-results',
      }}
      results={{
        id: 'project-results',
        count: t('results', { count: projects.length }),
        chips: projectFilterChips(filter, t as unknown as ChipTranslate, { skills: optionLabels(skillOptions), courses: optionLabels(courseOptions) }),
        chipsLabel: directory('activeFilters'),
        removeLabel: label => directory('removeFilter', { label }),
      }}
      // With no list there is no relationship h2 above the empty state, so its title is the page's h2.
      empty={projects.length === 0 && <BenchState kind={activeCount ? 'filtered' : 'empty'} titleAs="h2" title={activeCount ? t('filteredEmpty') : t('emptyNoProjects')} actions={activeCount ? <FilterLink href={routes.learner.projects()} className="vf-btn vf-btn-lg">{directory('clear')}</FilterLink> : <Link href={routes.learner.newProject()} className="vf-btn vf-btn-lg">{t('openProposal')}</Link>} />}
    >
      {displayed.map(({ relationship, items }) => items.length ? <section key={relationship} aria-labelledby={`build-${relationship}`}>
        <div className="vf-block-head"><div><h2 id={`build-${relationship}`} className="vf-h3">{t(`sections.${relationship}.title`)}</h2><p className="vf-project-section-desc">{t(`sections.${relationship}.description`)}</p></div><span className="vf-meta">{t('sections.count', { count: items.length })}</span></div>
        <ProjectTable projects={items} locale={locale} filter={filter} skillLabels={skillLabels} caption={t(`sections.${relationship}.title`)} />
      </section> : null)}
    </DirectoryPage>
  </div>;
}

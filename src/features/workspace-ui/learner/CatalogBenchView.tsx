import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PATHWAYS } from '@/content-engine/schema/course';
import type { CatalogFilters } from '@/features/catalog/service';
import { routes } from '@/lib/routes';
import { filterStateKey } from '@/lib/search-params';
import { coursePartLabel } from '../format';
import { BenchState } from '../ui/BenchState';
import { PageHeader } from '../ui/PageHeader';
import { EmptyBench, StateTag } from '../ui/primitives';
import { Segmented } from '../ui/Segmented';
import { catalogFilterChips, type ChipTranslate } from './directory/chips';
import { DirectoryPage } from './directory/DirectoryPage';
import { DirectoryTable, type DirectoryRow } from './directory/DirectoryTable';
import { FilterLink, type FilterField } from './directory/FilterBar';

const filterOptions = [
  ['level', ['foundation', 'specialization']],
  ['pathway', PATHWAYS],
  ['difficulty', ['beginner', 'intermediate', 'advanced']],
  ['language', ['vi', 'en']],
] as const;

export type CatalogBenchCourse = {
  id: string;
  title: string;
  level: string;
  difficulty: string;
  pathway: string;
  code?: string;
  estimatedMinutes?: number;
  languages: unknown[];
  enrollment: { status: unknown } | null;
  /** Prerequisite part labels the learner has not completed, when the read model provides them. */
  unmetPrerequisites?: string[];
};

type Tab = 'learning' | 'discover';

/** Part | Course (title, mono meta) | Depends on (only with data, hidden on phones) | Status | Next. */
function CatalogTable({ courses, listContext, caption }: { courses: CatalogBenchCourse[]; listContext: Record<string, string | undefined>; caption: string }) {
  const t = useTranslations('learner.catalog');
  const bench = useTranslations('bench.learner.catalog');
  const enums = useTranslations('learner.enums');
  const showDepends = courses.some(course => course.unmetPrerequisites?.length);
  const rows = courses.map((course): DirectoryRow => {
    const completed = course.enrollment?.status === 'completed';
    const languages = course.languages.filter((language): language is 'vi' | 'en' => language === 'vi' || language === 'en').map(language => language.toUpperCase()).join('/');
    return {
      id: course.id,
      lead: coursePartLabel(course),
      title: course.title,
      meta: [
        enums(`level.${course.level}` as 'level.foundation'),
        enums(`difficulty.${course.difficulty}` as 'difficulty.beginner'),
        course.estimatedMinutes ? t('minutes', { count: course.estimatedMinutes }) : null,
        languages || null,
      ].filter((entry): entry is string => Boolean(entry)),
      extra: course.unmetPrerequisites?.length
        ? <StateTag tone="pending">{bench('needs', { parts: course.unmetPrerequisites.join(', ') })}</StateTag>
        : undefined,
      status: {
        tone: course.enrollment && !completed ? 'signal' : 'neutral',
        label: completed ? t('completed') : course.enrollment ? t('enrolled') : t('notEnrolled'),
      },
      href: routes.learner.course(course.id, listContext),
      cta: bench('open'),
      ctaLabel: t('openCourse', { title: course.title }),
    };
  });
  return <DirectoryTable
    caption={caption}
    columns={{ lead: bench('columns.part'), title: bench('columns.course'), extra: showDepends ? bench('columns.dependsOn') : undefined, status: bench('columns.status'), cta: bench('columns.next') }}
    rows={rows}
  />;
}

/** /app/courses on the directory kit: segmented Learning/Discover, filters, results line, spec tables. */
export function CatalogBenchView({ courses, tab, filters }: { courses: CatalogBenchCourse[]; tab: Tab; filters: CatalogFilters }) {
  const t = useTranslations('learner.catalog');
  const bench = useTranslations('bench.learner.catalog');
  const directory = useTranslations('learner.directory');
  const enums = useTranslations('learner.enums');
  const focus = useTranslations('learner.focus');
  const listContext = { tab, ...filters };
  const queryForTab = (target: Tab) => ({ tab: target, ...filters });
  const yourCourses = courses.filter(course => course.enrollment?.status === 'active' || course.enrollment?.status === 'completed');
  const inProgress = yourCourses.filter(course => course.enrollment?.status !== 'completed');
  const completed = yourCourses.filter(course => course.enrollment?.status === 'completed');
  const availableCourses = courses.filter(course => !course.enrollment);
  const selected = tab === 'learning' ? yourCourses : availableCourses;
  const activeCount = Object.values(filters).filter(Boolean).length;
  const clearHref = routes.learner.courses({ tab });
  const fields = filterOptions.map(([name, options]): FilterField => ({
    kind: 'select',
    name,
    label: t(name),
    value: filters[name],
    allLabel: t('all'),
    options: options.map(option => ({ value: option, label: enums(`${name}.${option}` as 'level.foundation') })),
  }));

  return <DirectoryPage
    header={<PageHeader as="section" kicker={bench('kicker')} title={t('title')} titleId="catalog-title" lead={t('description')} />}
    tabs={<Segmented label={focus('courses')} items={(['learning', 'discover'] as const).map(key => ({ key, label: focus(key === 'learning' ? 'learningTab' : 'discoverTab'), href: routes.learner.courses(queryForTab(key)), current: tab === key }))} />}
    filters={{
      label: t('filters'),
      summary: activeCount ? directory('filtersSummary', { count: activeCount }) : directory('filters'),
      fields,
      hidden: { tab },
      stateKey: filterStateKey({ tab, ...filters }),
      activeCount,
      clearHref,
      columns: 4,
      resultsId: 'catalog-results',
    }}
    results={{
      id: 'catalog-results',
      count: t('results', { count: selected.length }),
      chips: catalogFilterChips(filters, tab, enums as unknown as ChipTranslate),
      chipsLabel: directory('activeFilters'),
      removeLabel: label => directory('removeFilter', { label }),
    }}
    // With no list there is no h2 above the empty state, so its title is the page's h2.
    empty={selected.length === 0 && (activeCount > 0
      ? <BenchState kind="filtered" titleAs="h2" title={bench('noMatchTitle')} body={bench('noMatchBody')} actions={<FilterLink href={clearHref} className="vf-btn vf-btn-lg">{directory('clear')}</FilterLink>} />
      : <EmptyBench headingLevel={2} title={tab === 'learning' ? t('yourCoursesEmpty') : t('availableCoursesEmpty')} action={<Link href={routes.learner.courses(queryForTab(tab === 'learning' ? 'discover' : 'learning'))} className="vf-btn vf-btn-lg">{tab === 'learning' ? focus('discoverTab') : focus('learningTab')}</Link>} />)}
  >
    {tab === 'learning' ? <>
      <section aria-labelledby="your-courses-heading">
        <div className="vf-block-head"><h2 id="your-courses-heading" className="vf-h3">{t('yourCourses')}</h2></div>
        {inProgress.length > 0 ? <CatalogTable courses={inProgress} listContext={listContext} caption={t('yourCourses')} /> : null}
      </section>
      {completed.length > 0 ? <details className="vf-l-disclosure">
        <summary>{focus('completedCourses')} ({completed.length})</summary>
        <CatalogTable courses={completed} listContext={listContext} caption={focus('completedCourses')} />
      </details> : null}
    </> : <section aria-labelledby="available-courses-heading">
      <div className="vf-block-head"><h2 id="available-courses-heading" className="vf-h3">{t('availableCourses')}</h2></div>
      <CatalogTable courses={availableCourses} listContext={listContext} caption={t('availableCourses')} />
    </section>}
  </DirectoryPage>;
}

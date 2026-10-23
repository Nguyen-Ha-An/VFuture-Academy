import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import type { Locale } from '@/content-engine';
import { getCourse, listCatalog } from '@/features/catalog/service';
import { parseCatalogContext, type CatalogSearchParams } from '@/features/learner/catalog-filters';
import { CourseCta } from '@/features/learner/ui/CourseCta';
import type { PrerequisiteLink } from '@/features/learner/ui/EnrollButton';
import { prerequisiteLabel } from '@/features/workspace-ui/format';
import { DetailPage, type ActionPanelProps } from '@/features/workspace-ui/learner/DetailPage';
import { PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card, StateTag, ToleranceBar, type Tone } from '@/features/workspace-ui/ui/primitives';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

type Course = Awaited<ReturnType<typeof getCourse>>;

/** Mono kind codes for outline rows; the spelled kind stays in the row for screen readers. */
const KIND_CODES: Record<string, string> = { lesson: 'LSN', exam: 'EXM', assignment: 'ASG' };
const statusTone = (status: string): Tone => status === 'completed' ? 'signal' : status === 'in_progress' ? 'pending' : 'neutral';

/** Labels (authored code, else title) for an unenrolled course's prerequisites; unknown ids keep the id. */
async function prerequisiteLinks(userId: string, course: Course, locale: Locale): Promise<PrerequisiteLink[]> {
  const ids = course.meta.prerequisites ?? [];
  if (course.enrollment || !ids.length) return [];
  let catalog: Awaited<ReturnType<typeof listCatalog>> = [];
  try {
    catalog = await listCatalog({ userId, roles: [] }, locale);
  } catch (error) {
    console.error('[learner course] prerequisite labels unavailable', error);
  }
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  return ids.map((id) => ({ id, label: prerequisiteLabel(id, byId) }));
}

export default async function LearnerCoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams?: Promise<CatalogSearchParams> }) {
  const [{ courseId }, listParams, user, localeValue, t, enums, focus, catalog] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({}),
    requireUser(),
    getLocale(),
    getTranslations('learner.course'),
    getTranslations('learner.enums'),
    getTranslations('learner.focus'),
    getTranslations('learner.catalog'),
  ]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const listContext = parseCatalogContext(listParams);
  let course: Course;
  try {
    course = await getCourse({ userId: user.id, roles: [] }, courseId, locale);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const prerequisites = await prerequisiteLinks(user.id, course, locale);

  const items = course.outline.modules.flatMap((module) => module.items);
  const firstItem = items[0];
  const firstIncomplete = items.find((item) => item.status !== 'completed') ?? firstItem;
  const itemCta = course.enrollment?.status === 'completed'
    ? firstItem && { item: firstItem, label: t('review') }
    : course.enrollment && firstIncomplete && { item: firstIncomplete, label: t('continue') };

  const { completedItems, totalItems } = course.progress;
  const progressLabel = t('progress', { done: completedItems, total: totalItems });
  const progressPercent = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  const pathway = enums(`pathway.${course.meta.pathway}`);
  const code = course.meta.code?.trim();

  const action: ActionPanelProps = {
    title: t('nextStep'),
    status: course.enrollment
      ? { tone: 'signal', label: course.enrollment.status === 'completed' ? enums('status.completed') : t('enrolled') }
      : undefined,
    body: course.enrollment && totalItems > 0 ? <>
      <p className="vf-meta" aria-hidden="true">{progressLabel}</p>
      <ToleranceBar value={progressPercent} label={progressLabel} />
    </> : undefined,
    action: <CourseCta
      courseId={course.id}
      enrolled={Boolean(course.enrollment)}
      cta={itemCta ? { href: routes.learner.courseItem(course.id, itemCta.item.id), label: itemCta.label } : null}
      prerequisites={prerequisites}
    />,
  };

  const info = [
    course.meta.level ? { label: catalog('level'), value: enums(`level.${course.meta.level}`) } : null,
    course.meta.difficulty ? { label: catalog('difficulty'), value: enums(`difficulty.${course.meta.difficulty}`) } : null,
    course.meta.estimatedMinutes ? { label: t('duration'), value: catalog('minutes', { count: course.meta.estimatedMinutes }) } : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return (
    <DetailPage
      header={<PageHeader
        crumbs={[{ label: focus('courses'), href: routes.learner.courses(listContext) }, { label: course.meta.title }]}
        kicker={code ? `${code} · ${pathway}` : pathway}
        title={course.meta.title}
        lead={course.meta.summary}
      />}
      action={action}
      aside={<>
        <Card title={focus('courseInformation')} titleId="course-information-heading">
          {info.length ? <dl className="vf-l-dl">{info.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl> : null}
          {course.skills.length > 0 ? <>
            <h3 className="vf-kicker vf-l-subhead" data-tone="muted">{t('skills')}</h3>
            <ul className="vf-l-tags">{course.skills.map((skill) => <li key={skill.id}><StateTag plain>{skill.name}</StateTag></li>)}</ul>
          </> : null}
        </Card>
        {course.completion.requirements.length > 0 ? <Card title={t('requirements')} titleId="requirements-heading">
          <ul className="vf-l-rows">
            {course.completion.requirements.map((requirement, index) => <li key={index} className="vf-l-req">
              <p>{t(`requirementsMap.${requirement.rule.type}`)}</p>
              {course.enrollment ? <span className="vf-l-req-state">
                {requirement.progress ? <span className="vf-meta">{t('requirementProgress', requirement.progress)}</span> : null}
                <StateTag tone={requirement.satisfied ? 'signal' : 'neutral'}>{requirement.satisfied ? t('requirementMet') : t('requirementPending')}</StateTag>
              </span> : null}
            </li>)}
          </ul>
        </Card> : null}
      </>}
    >
      <section aria-labelledby="outline-heading" className="vf-l-outline">
        <div className="vf-block-head"><h2 id="outline-heading" className="vf-h3">{t('outline')}</h2></div>
        {!course.enrollment ? <p className="vf-l-outline-note">{t('outlinePreview')}</p> : null}
        {course.outline.modules.length > 0
          ? course.outline.modules.map((module, moduleIndex) => (
            <Card key={module.id} flush headingLevel={3} title={<><span className="vf-l-module-code" aria-hidden="true">M{String(moduleIndex + 1).padStart(2, '0')}</span>{module.title}</>}>
              {module.items.length > 0 ? <ol className="vf-l-rows">
                {module.items.map((item) => {
                  const kind = enums(`kind.${item.type}`);
                  const requirement = item.required ? t('required') : t('optional');
                  const body = <>
                    <span className="vf-l-item-code" aria-hidden="true">{KIND_CODES[String(item.type)] ?? String(item.type).slice(0, 3).toUpperCase()}</span>
                    <span className="min-w-0 break-words">
                      <span className="vf-l-item-title">{item.title}</span>
                      <span className="vf-meta vf-l-item-meta"><span className="sr-only">{kind} · </span>{requirement}</span>
                    </span>
                  </>;
                  return <li key={item.id}>
                    {course.enrollment
                      ? <Link href={routes.learner.courseItem(course.id, item.id)} className="vf-l-item">
                        {body}
                        <span className="shrink-0"><StateTag tone={statusTone(item.status)}>{enums(`status.${item.status}`)}</StateTag></span>
                      </Link>
                      : <div className="vf-l-item" data-locked="">
                        {body}
                        <span className="shrink-0"><LockKeyhole className="size-4" aria-hidden="true" /><span className="sr-only">{t('previewLocked')}</span></span>
                      </div>}
                  </li>;
                })}
              </ol> : null}
            </Card>
          ))
          : <Card as="div"><p className="vf-l-prose vf-l-muted">{t('outlineEmpty')}</p></Card>}
      </section>

      {course.meta.learningOutcomes.length > 0 ? <Card title={t('outcomes')} titleId="outcomes-heading">
        <ul className="vf-l-outcomes">
          {course.meta.learningOutcomes.map((outcome, index) => <li key={index}>{outcome}</li>)}
        </ul>
      </Card> : null}
    </DetailPage>
  );
}

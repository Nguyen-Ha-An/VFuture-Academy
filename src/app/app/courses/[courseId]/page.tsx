import { BookOpen, ClipboardList, FileQuestion, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/content-engine';
import { getCourse, listCatalog } from '@/features/catalog/service';
import { listCourseResults, listCourseTasks, listLearningAnnouncements, listLearningCalendar } from '@/features/coursework/service';
import { parseCatalogContext, type CatalogSearchParams } from '@/features/learner/catalog-filters';
import { CourseCta } from '@/features/learner/ui/CourseCta';
import type { PrerequisiteLink } from '@/features/learner/ui/EnrollButton';
import { prerequisiteLabel } from '@/features/workspace-ui/format';
import { ActionPanel } from '@/features/workspace-ui/learner/DetailPage';
import { CanvasAlert } from '@/features/canvas/ui';
import { CanvasCourseWorkspace, courseTab } from '@/features/workspace-ui/learner/CanvasCourseWorkspace';
import { CanvasAnnouncements, CanvasResults, CanvasTasks, CanvasEmpty } from '@/features/workspace-ui/learner/CanvasLearningLists';
import { CanvasCalendar } from '@/features/workspace-ui/learner/CanvasCalendar';
import { calendarMonth } from '@/features/workspace-ui/learner/calendar-model';
import { canvasCopy } from '@/features/workspace-ui/learner/canvas-copy';
import { Card, StateTag, ToleranceBar, type Tone } from '@/features/workspace-ui/ui/primitives';
import { Crumbs } from '@/features/workspace-ui/ui/PageHeader';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

type Course = Awaited<ReturnType<typeof getCourse>>;
const KIND_ICONS = { lesson: BookOpen, exam: FileQuestion, assignment: ClipboardList };
const statusTone = (status: string): Tone => status === 'completed' ? 'signal' : status === 'in_progress' ? 'pending' : 'neutral';
async function prerequisiteLinks(userId: string, course: Course, locale: Locale): Promise<PrerequisiteLink[]> {
  const ids = course.meta.prerequisites ?? [];
  if (course.enrollment || !ids.length) return [];
  let catalog: Awaited<ReturnType<typeof listCatalog>> = [];
  try { catalog = await listCatalog({ userId, roles: [] }, locale); }
  catch (error) { console.error('[learner course] prerequisite labels unavailable', error); }
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  return ids.map(id => ({ id, label: prerequisiteLabel(id, byId) }));
}

export default async function LearnerCoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams?: Promise<CatalogSearchParams> }) {
  const [{ courseId }, listParams, user, localeValue, t, enums, focus, catalog] = await Promise.all([
    params, searchParams ?? Promise.resolve({} as CatalogSearchParams), requireUser(), getLocale(),
    getTranslations('learner.course'), getTranslations('learner.enums'), getTranslations('learner.focus'), getTranslations('learner.catalog'),
  ]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const copy = canvasCopy(locale);
  const listContext = parseCatalogContext(listParams);
  const tab = courseTab(listParams.view);
  const month = calendarMonth(typeof listParams.month === 'string' ? listParams.month : undefined);
  const actor = { userId: user.id, roles: [] };
  let course: Course;
  try { course = await getCourse(actor, courseId, locale); }
  catch (error) { if (error instanceof ApiError && error.status === 404) notFound(); throw error; }
  const prerequisites = await prerequisiteLinks(user.id, course, locale);
  const items = course.outline.modules.flatMap(module => module.items);
  const firstItem = items[0];
  const firstIncomplete = items.find(item => item.status !== 'completed') ?? firstItem;
  const itemCta = course.enrollment?.status === 'completed' ? firstItem && { item: firstItem, label: t('review') } : course.enrollment && firstIncomplete && { item: firstIncomplete, label: t('continue') };
  const { completedItems, totalItems } = course.progress;
  const progressLabel = t('progress', { done: completedItems, total: totalItems });
  const cta = <CourseCta courseId={course.id} enrolled={Boolean(course.enrollment)} cta={itemCta ? { href: routes.learner.courseItem(course.id, itemCta.item.id), label: itemCta.label } : null} prerequisites={prerequisites} />;
  const info = [
    course.meta.level ? { label: catalog('level'), value: enums(`level.${course.meta.level}`) } : null,
    course.meta.difficulty ? { label: catalog('difficulty'), value: enums(`difficulty.${course.meta.difficulty}`) } : null,
    course.meta.estimatedMinutes ? { label: t('duration'), value: catalog('minutes', { count: course.meta.estimatedMinutes }) } : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null);
  const outline = <section aria-labelledby="outline-heading" className="vf-l-outline"><div className="canvas-section-heading"><h3 id="outline-heading">{t('outline')}</h3></div>
    {!course.enrollment && <p className="vf-l-outline-note">{t('outlinePreview')}</p>}
    {course.outline.modules.length ? course.outline.modules.map((module, moduleIndex) => <details key={module.id} className="canvas-module" open><summary><h3><span className="vf-l-module-code" aria-hidden="true">M{String(moduleIndex + 1).padStart(2, '0')}</span>{module.title}</h3></summary>
      <ol className="vf-l-rows">{module.items.map(item => {
        const ItemIcon = KIND_ICONS[item.type as keyof typeof KIND_ICONS] ?? BookOpen;
        const body = <><span className="vf-l-item-code" aria-hidden="true"><ItemIcon size={20} /></span><span className="min-w-0 break-words"><span className="vf-l-item-title">{item.title}</span><span className="vf-meta vf-l-item-meta"><span className="sr-only">{enums(`kind.${item.type}`)} · </span>{item.required ? t('required') : t('optional')}</span></span></>;
        return <li key={item.id}>{course.enrollment ? <Link href={routes.learner.courseItem(course.id, item.id)} className="vf-l-item">{body}<StateTag tone={statusTone(item.status)}>{enums(`status.${item.status}`)}</StateTag></Link> : <div className="vf-l-item" data-locked="">{body}<span><LockKeyhole className="size-4" aria-hidden="true" /><span className="sr-only">{t('previewLocked')}</span></span></div>}</li>;
      })}</ol>
    </details>) : <CanvasEmpty>{t('outlineEmpty')}</CanvasEmpty>}
  </section>;
  const requirements = course.completion.requirements.length ? <Card title={t('requirements')} titleId="requirements-heading"><ul className="vf-l-rows">{course.completion.requirements.map((requirement, index) => <li key={index} className="vf-l-req"><p>{t(`requirementsMap.${requirement.rule.type}`)}</p>{course.enrollment && <span className="vf-l-req-state">{requirement.progress && <span className="vf-meta">{t('requirementProgress', requirement.progress)}</span>}<StateTag tone={requirement.satisfied ? 'signal' : 'neutral'}>{requirement.satisfied ? t('requirementMet') : t('requirementPending')}</StateTag></span>}</li>)}</ul></Card> : null;
  const overview = <div className="canvas-course-overview"><div className="canvas-course-overview-main"><p className="canvas-course-description">{course.meta.summary}</p>
    {course.meta.learningOutcomes.length > 0 && <Card title={t('outcomes')} titleId="outcomes-heading"><ul className="vf-l-outcomes">{course.meta.learningOutcomes.map((outcome, index) => <li key={index}>{outcome}</li>)}</ul></Card>}
    {!course.enrollment && outline}{requirements}
  </div><aside className="canvas-course-overview-aside" aria-label={copy.courseInformation}>
    <ActionPanel title={t('nextStep')} status={course.enrollment ? { tone: 'signal', label: course.enrollment.status === 'completed' ? enums('status.completed') : t('enrolled') } : undefined} body={course.enrollment && totalItems > 0 ? <><p className="vf-meta">{progressLabel}</p><ToleranceBar value={totalItems ? completedItems / totalItems * 100 : 0} label={progressLabel} /></> : undefined} action={cta} />
    <Card title={focus('courseInformation')} titleId="course-information-heading"><dl className="vf-l-dl">{info.map(entry => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>{course.skills.length > 0 && <><h3 className="vf-l-subhead">{t('skills')}</h3><ul className="vf-l-tags">{course.skills.map(skill => <li key={skill.id}><StateTag plain>{skill.name}</StateTag></li>)}</ul></>}</Card>
  </aside></div>;
  // Load only the selected tab. A secondary read failure leaves the course and its learning actions usable.
  async function secondary<T>(read: () => Promise<T>): Promise<T | null> { try { return await read(); } catch (error) { console.error('[learner course] tab unavailable', error); return null; } }
  const query = { courseId, locale };
  const tasks = tab === 'assignments' && course.enrollment ? await secondary(() => listCourseTasks(actor, query)) : [];
  const results = tab === 'grades' && course.enrollment ? await secondary(() => listCourseResults(actor, query)) : [];
  const announcements = tab === 'announcements' && course.enrollment ? await secondary(() => listLearningAnnouncements(actor, query)) : [];
  const calendar = tab === 'calendar' && course.enrollment ? await secondary(() => listLearningCalendar(actor, { ...query, start: month.start, end: month.end })) : { events: [] };
  const enrollmentNotice = <CanvasAlert variant="info">{locale === 'en' ? 'Enroll in this course to view its assignments, grades, announcements and calendar.' : 'Ghi danh khóa học để xem bài tập, điểm số, thông báo và lịch học.'}{' '}<Link href={routes.learner.course(course.id, { ...listContext, view: 'overview' })}>{copy.overview}</Link></CanvasAlert>;
  return <CanvasCourseWorkspace id={course.id} title={course.meta.title} code={course.meta.code?.trim() || enums(`pathway.${course.meta.pathway}`)} locale={locale} tab={tab} listContext={listContext}
    header={<Crumbs items={[{ label: focus('courses'), href: routes.learner.courses(listContext) }, { label: course.meta.title }]} />}
    overview={overview} modules={outline}
    assignments={!course.enrollment ? enrollmentNotice : <div className="canvas-panel canvas-assignment-group"><CanvasTasks tasks={tasks} locale={locale} showCourse={false} emptyMessage={copy.noAssignments} /></div>}
    grades={!course.enrollment ? enrollmentNotice : <CanvasResults results={results?.map(result => ({ ...result, score: result.points, maxScore: result.maxPoints })) ?? null} locale={locale} showCourse={false} />}
    announcements={!course.enrollment ? enrollmentNotice : <CanvasAnnouncements entries={announcements} locale={locale} />}
    calendar={!course.enrollment ? enrollmentNotice : <CanvasCalendar month={month.key} events={calendar?.events ?? null} locale={locale} hrefForMonth={value => routes.learner.course(course.id, { ...listContext, view: 'calendar', month: value })} />}
  />;
}

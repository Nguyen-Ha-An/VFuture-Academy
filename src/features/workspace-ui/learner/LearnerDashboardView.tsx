'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, ClipboardList, FileQuestion, Bell, CalendarDays } from 'lucide-react';
import { routes } from '@/lib/routes';
import { CanvasButton, CanvasSelect, CanvasProgressBar } from '@/features/canvas/ui';
import { canvasCopy, canvasDate } from './canvas-copy';
import type { CanvasAnnouncement, CanvasResult, CanvasTask } from './canvas-model';
import { percentOf, type BenchCourseRow, type BenchProgress, type LearnerDashboardData } from './model';
import './dashboard.css';

export function ProgressMeter({ course, progress }: { course: string; progress: BenchProgress | null | undefined }) {
  const t = useTranslations('bench.learner.dashboard');
  if (!progress || progress.total === 0) return <span className="canvas-muted" title={t('progressUnknown')}>—<span className="sr-only"> {t('progressUnknown')}</span></span>;
  const percent = percentOf(progress);
  return <div className="canvas-progress"><CanvasProgressBar size="x-small" valueNow={percent} valueMax={100} meterColor="brand" shouldAnimate={false} screenReaderLabel={t('progressLabel', { course, completed: progress.completed, total: progress.total, percent })} /><span>{percent}%</span></div>;
}

export function ActiveCoursesTable({ courses }: { courses: BenchCourseRow[] }) {
  const copy = canvasCopy(useLocale());
  return <div className="canvas-dashboard-course-rows">{courses.map(course => <article className="canvas-dashboard-course-row" key={course.id}>
    <span className="canvas-dashboard-course-mark" aria-hidden="true">{course.part || <BookOpen size={20} />}</span>
    <div className="canvas-dashboard-course-info"><h3><Link href={course.href}>{course.title}</Link></h3><p className="canvas-muted">{course.sub}</p></div>
    <div className="canvas-dashboard-course-progress"><span className="sr-only">{copy.progress}</span><ProgressMeter course={course.title} progress={course.progress} /></div>
    <Link className="canvas-dashboard-course-open" href={course.href} aria-label={`${copy.viewCourse}: ${course.title}`}><ArrowRight size={18} aria-hidden="true" /></Link>
  </article>)}</div>;
}

type TaskFilter = 'all' | 'todo' | 'overdue' | 'submitted' | 'completed';
const actionable = (task: CanvasTask) => ['not_started', 'in_progress', 'changes_requested'].includes(task.status);
const submitted = (task: CanvasTask) => ['submitted', 'in_review'].includes(task.status);
const complete = (task: CanvasTask) => ['completed', 'approved', 'graded'].includes(task.status);
const overdue = (task: CanvasTask, now: number) => actionable(task) && task.dueAt !== null && Date.parse(task.dueAt) < now;
const copyFor = (en: boolean) => en ? {
  coursework: 'Coursework', all: 'All coursework', todo: 'To do', overdue: 'Overdue', submitted: 'Submitted', completed: 'Completed',
  course: 'Course', allCourses: 'All courses', status: 'Status', noMatch: 'No coursework matches these filters.', reset: 'Show all coursework',
  upcoming: 'Coming up', results: 'Recent results', noResults: 'Released results will appear here after your work is graded.',
  showTasks: (count: number) => `Show all ${count} activities`, fewerTasks: 'Show fewer activities', showMore: 'Show all announcements', showLess: 'Show fewer announcements', readAnnouncement: 'Read announcement', greeting: 'Your learning', items: (count: number) => `${count} ${count === 1 ? 'activity' : 'activities'}`, unavailable: 'Coursework is temporarily unavailable. Open all tasks to try again.',
} : {
  coursework: 'Bài tập của bạn', all: 'Tất cả bài tập', todo: 'Cần làm', overdue: 'Quá hạn', submitted: 'Đã nộp', completed: 'Hoàn thành',
  course: 'Khóa học', allCourses: 'Tất cả khóa học', status: 'Trạng thái', noMatch: 'Không có bài tập phù hợp với bộ lọc.', reset: 'Xem tất cả bài tập',
  upcoming: 'Sắp diễn ra', results: 'Kết quả gần đây', noResults: 'Kết quả sẽ xuất hiện sau khi bài làm được chấm và công bố.',
  showTasks: (count: number) => `Xem tất cả ${count} hoạt động`, fewerTasks: 'Thu gọn hoạt động', showMore: 'Xem tất cả thông báo', showLess: 'Thu gọn thông báo', readAnnouncement: 'Đọc thông báo', greeting: 'Việc học của bạn', items: (count: number) => `${count} hoạt động`, unavailable: 'Tạm thời không tải được bài tập. Mở tất cả nhiệm vụ để thử lại.',
};

export function LearnerDashboardView({ data, tasks, results, announcements, trace: _trace, readout: _readout }: {
  data: LearnerDashboardData; tasks?: CanvasTask[] | null; results?: CanvasResult[] | null; announcements?: CanvasAnnouncement[] | null; trace?: ReactNode; readout?: ReactNode;
}) {
  const locale = useLocale();
  const copy = canvasCopy(locale);
  const labels = copyFor(locale === 'en');
  const t = useTranslations('bench.learner.dashboard');
  const home = useTranslations('learner.home');
  const [courseFilter, setCourseFilter] = useState('all');
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskFilter>('todo');
  const { resume, courses, feedback, completion } = data;
  const isActiveExam = resume?.kind === 'exam' && typeof resume.attemptId === 'string';
  const resumeActionLabel = isActiveExam ? copy.resumeExam : copy.continueLearning;
  const now = new Date(data.now).getTime();
  const courseKey = (task: CanvasTask) => task.courseId ?? task.courseTitle;
  const courseOptions = [...new Map((tasks ?? []).map(task => [courseKey(task), task.courseTitle])).entries()];
  const effectiveCourseFilter = courseOptions.some(([key]) => key === courseFilter) ? courseFilter : 'all';
  const scopedTasks = (tasks ?? []).filter(task => effectiveCourseFilter === 'all' || courseKey(task) === effectiveCourseFilter);
  const matching = (task: CanvasTask, filter: TaskFilter) => filter === 'all' || (filter === 'todo' ? actionable(task) : filter === 'overdue' ? overdue(task, now) : filter === 'submitted' ? submitted(task) : complete(task));
  const visibleTasks = scopedTasks.filter(task => matching(task, statusFilter));
  const statusOptions: TaskFilter[] = ['all', 'todo', 'overdue', 'submitted', 'completed'];
  const taskStatus = (task: CanvasTask) => overdue(task, now) ? labels.overdue : complete(task) ? copy.completed : task.status === 'submitted' ? copy.submitted : task.status === 'in_review' ? copy.inReview : task.status === 'changes_requested' ? copy.changesRequested : task.status === 'in_progress' ? copy.inProgress : copy.pending;
  const greeting = data.name ? t('greeting', { name: data.name }) : t('greetingAnonymous');
  const firstRun = data.state === 'first-run' && courses.length === 0 && tasks?.length === 0 && results?.length === 0;
  const hasAside = Boolean(data.exam || feedback || announcements?.length || announcements === null);
  return <div className="canvas-page canvas-learning canvas-dashboard canvas-dashboard-refined">
    <header className="canvas-page-heading canvas-dashboard-heading"><div><p className="canvas-dashboard-eyebrow">{labels.greeting}</p><h1 tabIndex={-1}>{copy.dashboard}</h1><p className="canvas-muted canvas-dashboard-greeting" title={greeting}>{greeting} · {copy.welcome}</p></div><CanvasButton href={routes.learner.courses({ tab: 'discover' })} variant="outline">{copy.browse}</CanvasButton></header>
    <nav className="canvas-dashboard-tabs" aria-label={labels.greeting}><Link href={routes.learner.dashboard()} aria-current="page">{copy.dashboard}</Link><Link href={routes.learner.courses({ tab: 'learning' })}>{copy.courses}</Link></nav>
    {completion && <p className="canvas-completion">{t('completionStrip', { part: completion.part, course: completion.courseTitle })} <Link href={`${routes.learner.profile()}#certificates-heading`}>{t('viewCertificate')}</Link></p>}
    <div className={`canvas-dashboard-content${hasAside ? ' has-aside' : ''}`}><div className="canvas-dashboard-main">
      <section className="canvas-panel canvas-coursework" aria-labelledby="dashboard-coursework-heading">
        <div className="canvas-dashboard-section-title"><h2 id="dashboard-coursework-heading">{firstRun ? copy.courses : labels.coursework}</h2>{!firstRun && <Link href={routes.learner.tasks()}>{copy.allTasks}<ArrowRight size={15} aria-hidden="true" /></Link>}</div>
        {firstRun ? <div className="canvas-dashboard-first-run"><BookOpen size={32} aria-hidden="true" /><p>{copy.chooseCourse}</p><CanvasButton href={routes.learner.courses({ tab: 'discover' })} data-canvas-action="continue">{copy.browse}</CanvasButton></div> : <><div className="canvas-coursework-counters" aria-label={labels.status}>{(['todo', 'overdue', 'submitted'] as TaskFilter[]).map(filter => <button type="button" key={filter} aria-pressed={statusFilter === filter} onClick={() => { setStatusFilter(filter); setExpandedTasks(false); }} className="canvas-coursework-counter" data-tone={filter === 'overdue' && scopedTasks.some(task => overdue(task, now)) ? 'attention' : undefined}><span>{labels[filter]}</span><strong>{tasks == null ? '—' : scopedTasks.filter(task => matching(task, filter)).length}</strong></button>)}</div>
        <div className="canvas-coursework-filters"><CanvasSelect label={labels.course} value={effectiveCourseFilter} onChange={value => { setCourseFilter(value); setExpandedTasks(false); }} options={[{ value: 'all', label: labels.allCourses }, ...courseOptions.map(([value, label]) => ({ value, label }))]} disabled={tasks == null} /><CanvasSelect label={labels.status} value={statusFilter} onChange={value => { setStatusFilter(value as TaskFilter); setExpandedTasks(false); }} options={statusOptions.map(value => ({ value, label: labels[value] }))} disabled={tasks == null} /></div>
        {tasks == null ? <p role="status" className="canvas-dashboard-empty">{labels.unavailable}</p> : <><p className="canvas-coursework-count" aria-live="polite">{labels.items(visibleTasks.length)}</p>{visibleTasks.length ? <ul className={`canvas-dashboard-task-rows${expandedTasks ? ' is-expanded' : ''}`} id="dashboard-task-list">{visibleTasks.map(task => <li key={task.id}>
          <span className="canvas-dashboard-task-icon" aria-hidden="true">{task.kind === 'exam' ? <FileQuestion size={21} /> : task.kind === 'lesson' ? <BookOpen size={21} /> : <ClipboardList size={21} />}</span>
          <div className="canvas-dashboard-task-info"><Link href={task.href}>{task.title}</Link><p>{task.courseTitle} <span aria-hidden="true">·</span> {task.kind === 'exam' ? copy.exam : task.kind === 'lesson' ? copy.lesson : copy.assignment} <span aria-hidden="true">·</span> <span className="canvas-dashboard-task-state">{taskStatus(task)}{task.late === true ? ` · ${copy.submittedLate}` : ''}</span></p></div>
          <div className="canvas-dashboard-task-due" data-overdue={overdue(task, now) || undefined}>{task.dueAt ? <><span>{copy.due}</span><time dateTime={task.dueAt}>{canvasDate(task.dueAt, locale)}</time></> : <span>{copy.noDue}</span>}</div>
          <Link className="canvas-dashboard-task-open" href={task.href} aria-label={`${copy.open}: ${task.title}`}><ArrowRight size={18} aria-hidden="true" /></Link>
        </li>)}</ul> : <div className="canvas-dashboard-empty"><p>{tasks.length ? labels.noMatch : copy.noAllTasks}</p>{tasks.length > 0 && <CanvasButton variant="link" onClick={() => { setStatusFilter('all'); setCourseFilter('all'); }}>{labels.reset}</CanvasButton>}</div>}{visibleTasks.length > 3 && <div className={`canvas-dashboard-task-more${visibleTasks.length === 4 ? ' only-mobile' : ''}`}><CanvasButton variant="link" size="sm" aria-expanded={expandedTasks} aria-controls="dashboard-task-list" onClick={() => setExpandedTasks(value => !value)}>{expandedTasks ? labels.fewerTasks : labels.showTasks(visibleTasks.length)}</CanvasButton></div>}</>}</>}
      </section>
      {!firstRun && <section className="canvas-panel canvas-dashboard-course-section" aria-labelledby="active-courses-heading"><div className="canvas-dashboard-section-title"><h2 id="active-courses-heading">{copy.courses}</h2><Link href={routes.learner.courses({ tab: 'learning' })}>{copy.allCourses}<ArrowRight size={15} aria-hidden="true" /></Link></div>{courses.length ? <ActiveCoursesTable courses={courses} /> : <p className="canvas-dashboard-empty">{copy.chooseCourse}</p>}
        {resume && <div className="canvas-dashboard-resume"><div><span>{copy.continueLearning} · {resume.courseTitle}</span><Link href={resume.href}>{resume.title}</Link></div><CanvasButton href={resume.href} size="sm" data-canvas-action="continue" aria-label={isActiveExam ? `${resumeActionLabel}: ${resume.title}` : home('resume', { item: resume.title })}>{resumeActionLabel}</CanvasButton></div>}
      </section>}
      {!firstRun && <section className="canvas-panel canvas-dashboard-results" aria-labelledby="dashboard-results-heading"><div className="canvas-dashboard-section-title"><h2 id="dashboard-results-heading">{labels.results}</h2><Link href="/app/results">{copy.allResults}<ArrowRight size={15} aria-hidden="true" /></Link></div>{results?.length ? <ul>{results.slice(0, 4).map(result => <li key={result.id}><div><Link href={result.href}>{result.title}</Link><p className="canvas-muted">{result.courseTitle}{result.recordedAt && <> · <time dateTime={result.recordedAt}>{canvasDate(result.recordedAt, locale, false)}</time></>}</p></div><strong>{result.score === null ? '—' : <>{result.score}{result.maxScore !== null && <span> / {result.maxScore}</span>}</>}</strong></li>)}</ul> : <p className="canvas-dashboard-empty">{results == null ? copy.unavailable : labels.noResults}</p>}</section>}
    </div>{hasAside && <aside className="canvas-dashboard-side" aria-label={copy.recent}>
      {(!!announcements?.length || announcements === null) && <section className="canvas-dashboard-side-section"><h2><Bell size={18} aria-hidden="true" />{copy.announcements}</h2>{announcements === null && <p role="status" className="canvas-muted">{copy.unavailable}</p>}{announcements?.slice(0, showAllAnnouncements ? undefined : 2).map(entry => <article key={entry.id}><p className="canvas-dashboard-date"><time dateTime={entry.publishedAt}>{canvasDate(entry.publishedAt, locale, false)}</time>{entry.courseTitle && <> · {entry.courseTitle}</>}</p><h3>{entry.courseId ? <Link href={routes.learner.course(entry.courseId, { view: 'announcements' })}>{entry.title}</Link> : entry.title}</h3>{entry.body.length > 240 ? <details className="canvas-dashboard-announcement-detail"><summary>{labels.readAnnouncement}</summary><p className="canvas-dashboard-announcement-body">{entry.body}</p></details> : <p className="canvas-dashboard-announcement-body">{entry.body}</p>}</article>)}{announcements && announcements.length > 2 && <CanvasButton variant="link" size="sm" aria-expanded={showAllAnnouncements} onClick={() => setShowAllAnnouncements(value => !value)}>{showAllAnnouncements ? labels.showLess : labels.showMore}</CanvasButton>}</section>}
      {data.exam && <section className="canvas-dashboard-side-section"><h2><CalendarDays size={18} aria-hidden="true" />{labels.upcoming}</h2><article><p className="canvas-dashboard-date">{data.exam.courseTitle}</p><h3><Link href={data.exam.href}>{data.exam.title}</Link></h3>{data.exam.openAt && <p>{copy.examOpens}: <time dateTime={data.exam.openAt}>{canvasDate(data.exam.openAt, locale)}</time></p>}{data.exam.closeAt && <p>{copy.examCloses}: <time dateTime={data.exam.closeAt}>{canvasDate(data.exam.closeAt, locale)}</time></p>}</article></section>}
      {feedback && <section className="canvas-dashboard-side-section"><h2>{copy.feedback}</h2><article><p className="canvas-dashboard-date">{feedback.courseTitle} · <time dateTime={feedback.at}>{canvasDate(feedback.at, locale, false)}</time></p><h3><Link href={feedback.href}>{feedback.title}</Link></h3><blockquote>{feedback.message}</blockquote><span className="canvas-status">{home(feedback.decision === 'approved' ? 'feedbackApproved' : 'feedbackChangesRequested')}</span></article></section>}
    </aside>}</div>
  </div>;
}

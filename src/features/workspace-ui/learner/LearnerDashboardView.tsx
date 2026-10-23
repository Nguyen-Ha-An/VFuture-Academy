import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Suspense, type ReactNode } from 'react';
import { routes } from '@/lib/routes';
import { ictDate, ictTime, isoWeek } from '../format';
import { SectionBoundary } from '../ui/SectionBoundary';
import { BenchSkeleton, Kicker, MentorQuote, Notice, StateTag, ToleranceBar } from '../ui/primitives';
import { examDeadline, percentOf, type BenchCourseRow, type BenchProgress, type LearnerDashboardData } from './model';

function useProgressLabel() {
  const t = useTranslations('bench.learner.dashboard');
  return (course: string, progress: BenchProgress) => {
    const label = t('progressLabel', { course, completed: progress.completed, total: progress.total, percent: percentOf(progress) });
    return progress.band ? t('progressTarget', { label, from: Math.round(progress.band[0]), to: Math.round(progress.band[1]), date: progress.due ? ictDate(new Date(progress.due)).slice(0, 5) : '—' }) : label;
  };
}

export function ProgressMeter({ course, progress }: { course: string; progress: BenchProgress | null | undefined }) {
  const t = useTranslations('bench.learner.dashboard');
  const label = useProgressLabel();
  if (!progress || progress.total === 0) return <span className="vf-meta" title={t('progressUnknown')}>—<span className="sr-only"> {t('progressUnknown')}</span></span>;
  const percent = percentOf(progress);
  const behind = progress.band ? percent < progress.band[0] : false;
  return <div className="vf-l-meter"><ToleranceBar value={percent} band={progress.band ?? null} tone={behind ? 'pending' : undefined} label={label(course, progress)} /><span className="vf-l-pct" aria-hidden="true">{percent}%</span></div>;
}

/** Active-courses spec sheet: Part, Course, Depends on (only with data), Progress, Next. Stacks on phones. */
export function ActiveCoursesTable({ courses }: { courses: BenchCourseRow[] }) {
  const t = useTranslations('bench.learner.dashboard');
  const focus = useTranslations('learner.focus');
  const showDepends = courses.some(course => course.dependsOn?.length);
  return <table className="vf-spec" data-stack="">
    <thead><tr>
      <th scope="col">{t('columns.part')}</th>
      <th scope="col">{t('columns.course')}</th>
      {showDepends && <th scope="col" data-col="hide-sm">{t('columns.dependsOn')}</th>}
      <th scope="col" style={{ minWidth: 140 }}>{t('columns.progress')}</th>
      <th scope="col" className="vf-num">{t('columns.next')}</th>
    </tr></thead>
    <tbody>{courses.map(course => <tr key={course.id}>
      <td data-slot="lead" className="vf-part">{course.part}</td>
      <td data-slot="body"><h3 className="vf-l-row-title"><Link href={course.href} className="vf-l-title-link">{course.title}</Link></h3><span className="vf-sub">{course.sub}</span></td>
      {showDepends && <td data-col="hide-sm" className="vf-meta">{course.dependsOn?.length ? course.dependsOn.join(', ') : '—'}</td>}
      <td data-slot="meter"><ProgressMeter course={course.title} progress={course.progress} /></td>
      <td data-slot="trail" className="vf-l-next-cell">{course.next
        ? <Link href={course.next.href} className="vf-l-next" aria-label={t('nextLabel', { item: course.next.title })}>{course.next.code}</Link>
        : <Link href={course.href} className="vf-l-next">{focus('openCourse')}</Link>}</td>
    </tr>)}</tbody>
  </table>;
}

/**
 * /app in the Calibration Bench (AppShell's data-layout="home"): the full-width Trace Rail, then
 * the page frame with the resume anchor (h1 = current lesson), active courses as a spec sheet,
 * exams and mentor feedback in the main column and the Readout in the aside (stacked below 1100px).
 * Secondary blocks arrive as slots, each behind its own boundary and Suspense (spec 4.12).
 */
export function LearnerDashboardView({ data, trace, readout }: { data: LearnerDashboardData; trace?: ReactNode; readout?: ReactNode }) {
  const t = useTranslations('bench.learner.dashboard');
  const home = useTranslations('learner.home');
  const focus = useTranslations('learner.focus');
  const shared = useTranslations('bench.shared');
  const progressLabel = useProgressLabel();
  const { now, resume, exam, feedback, completion, courses, state } = data;
  const deadline = examDeadline(exam, now);
  const greeting = data.name ? t('greeting', { name: data.name }) : t('greetingAnonymous');
  const title = state === 'resume' && resume ? resume.title : state === 'caught-up' ? t('caughtUpTitle') : state === 'completed' ? t('completedTitle') : t('firstRunTitle');
  const primary = state === 'resume' && resume
    ? { href: resume.href, label: home('resume', { item: resume.title }) }
    : state === 'caught-up'
      ? { href: routes.learner.courses({ tab: 'learning' }), label: home('openCourses') }
      : { href: routes.learner.courses({ tab: 'discover' }), label: home('browse') };
  const body = state === 'caught-up' ? home('noNextActivity') : state === 'completed' ? home('completedCourses') : state === 'first-run' ? t('firstRunBody') : null;

  return <>
    <SectionBoundary label={t('traceLabel')}>
      <div className="vf-l-trace-slot"><Suspense fallback={<div className="vf-trace vf-sweep" aria-hidden="true" />}>{trace}</Suspense></div>
    </SectionBoundary>
    <div className="vf-l-page">
      <div className="vf-l-frame vf-l-split" data-aside="">
        <div className="grid" data-area="main">
          {completion && <div className="vf-l-completion mb-6"><Notice tone="signal" label={t('calibrated')} action={<Link href={`${routes.learner.profile()}#certificates-heading`} className="vf-l-link">{t('viewCertificate')}<span className="vf-l-arrow" aria-hidden="true"> →</span></Link>}>{t('completionStrip', { part: completion.part, course: completion.courseTitle })}</Notice></div>}

          <section aria-label={home('continueLearning')} className={state === 'first-run' ? 'vf-l-resume vf-grid-bg vf-anchor-in' : 'vf-l-resume vf-anchor-in'} data-state={state}>
            <Kicker>{t('kicker')}</Kicker>
            <h1 className="vf-title-sm">{title}</h1>
            <p className="vf-meta vf-l-head-meta m-0">
              <span>{greeting}</span>
              <span>{t('week', { week: String(isoWeek(now)).padStart(2, '0') })}</span>
              <span>{ictDate(now)}</span>
              <span>{ictTime(now)} ICT</span>
              {deadline && <span className="vf-l-head-deadline">{t(deadline.kind === 'opens' ? 'deadlineOpens' : 'deadlineCloses', { countdown: deadline.countdown })}</span>}
            </p>
            <div className="vf-l-resume-body">
              <div className="vf-l-resume-meter">
                {state === 'resume' && resume ? <>
                  <p className="vf-meta m-0">{[resume.part, resume.position, resume.minutes ? t('minutes', { count: resume.minutes }) : null, resume.courseTitle].filter(Boolean).join(' · ')}</p>
                  {resume.progress && resume.progress.total > 0 ? <ToleranceBar value={percentOf(resume.progress)} band={resume.progress.band ?? null} tone={resume.progress.band && percentOf(resume.progress) < resume.progress.band[0] ? 'pending' : undefined} label={progressLabel(resume.courseTitle, resume.progress)} /> : null}
                </> : body ? <p className="vf-l-lead">{body}</p> : null}
              </div>
              <Link href={primary.href} className="vf-btn vf-btn-primary vf-btn-lg">{primary.label}<span className="vf-l-arrow" aria-hidden="true">→</span></Link>
            </div>
          </section>

          {courses.length > 0 && <section className="vf-block" aria-labelledby="active-courses-heading">
            <div className="vf-block-head"><h2 id="active-courses-heading" className="vf-h2">{focus('activeCourses')}</h2><Link href={routes.learner.courses({ tab: 'learning' })} className="vf-l-link">{focus('seeAll')}<span className="vf-l-arrow" aria-hidden="true"> →</span></Link></div>
            <ActiveCoursesTable courses={courses} />
          </section>}

          {exam && <section className="vf-block" aria-labelledby="upcoming-exam-heading">
            <div className="vf-block-head"><h2 id="upcoming-exam-heading" className="vf-h2">{home('upcomingExam')}</h2></div>
            <div className="vf-l-exam">
              <StateTag tone="pending">{deadline?.kind === 'opens' ? t('examScheduled') : t('examOpen')}</StateTag>
              <div className="min-w-0"><p className="vf-l-exam-title">{exam.title}</p><p className="vf-meta m-0">{exam.part} · {exam.courseTitle}</p></div>
              {deadline ? <span className="vf-l-countdown">{t(deadline.kind === 'opens' ? 'deadlineOpens' : 'deadlineCloses', { countdown: deadline.countdown })} <span className="vf-meta">· {deadline.stamp}</span></span> : <span className="vf-meta">—</span>}
              <Link href={exam.href} className="vf-btn vf-btn-lg">{home('openExam', { item: exam.title })}<span className="vf-l-arrow" aria-hidden="true">→</span></Link>
            </div>
          </section>}

          {feedback && <SectionBoundary label={home('recentFeedback')} silent>
            <section className="vf-block" aria-labelledby="recent-feedback-heading">
              <div className="vf-block-head"><h2 id="recent-feedback-heading" className="vf-h2">{home('recentFeedback')}</h2><Link href={feedback.href} className="vf-l-link">{home('openFeedback')}<span className="vf-l-arrow" aria-hidden="true"> →</span></Link></div>
              <MentorQuote author={home(feedback.decision === 'approved' ? 'feedbackApproved' : 'feedbackChangesRequested')} meta={`${feedback.title} · ${ictDate(new Date(feedback.at))}`}>{feedback.message}</MentorQuote>
            </section>
          </SectionBoundary>}
        </div>
        <aside className="vf-readout" data-area="aside" aria-label={t('readoutLabel')}>
          <SectionBoundary label={t('readoutLabel')}>
            <Suspense fallback={<div className="vf-readout-cell"><BenchSkeleton rows={4} label={shared('loading', { label: t('readoutLabel') })} /></div>}>{readout}</Suspense>
          </SectionBoundary>
        </aside>
      </div>
    </div>
  </>;
}

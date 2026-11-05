import Link from 'next/link';
import { CanvasAlert } from '@/features/canvas/ui';
import { BookOpen, ClipboardList, FileQuestion } from 'lucide-react';
import './learner-routes.css';
import { CanvasResultTable } from './CanvasResultTable';
import { canvasCopy, canvasDate } from './canvas-copy';
import type { CanvasAnnouncement, CanvasResult, CanvasTask } from './canvas-model';

export function CanvasEmpty({ children }: { children: React.ReactNode }) {
  return <p className="canvas-empty canvas-learner-empty">{children}</p>;
}
export function CanvasAnnouncements({ entries, locale }: { entries: CanvasAnnouncement[] | null; locale: string }) {
  const copy = canvasCopy(locale);
  if (!entries) return <CanvasAlert variant="warning">{copy.unavailable}</CanvasAlert>;
  if (!entries.length) return <CanvasEmpty>{copy.noAnnouncements}</CanvasEmpty>;
  return <div className="canvas-announcements">{entries.map(entry => <article key={entry.id} className="canvas-announcement">
    <h3>{entry.title}</h3><p className="canvas-muted">{entry.courseTitle ? `${entry.courseTitle} · ` : ''}<time dateTime={entry.publishedAt}>{canvasDate(entry.publishedAt, locale)}</time></p>
    <div className="canvas-announcement-body">{entry.body}</div>
  </article>)}</div>;
}
export function CanvasTasks({ tasks, locale, compact = false, allTasks = false, showCourse = true, emptyMessage }: { tasks: CanvasTask[] | null; locale: string; compact?: boolean; allTasks?: boolean; showCourse?: boolean; emptyMessage?: string }) {
  const copy = canvasCopy(locale);
  if (!tasks) return <CanvasAlert variant="warning">{copy.unavailable}</CanvasAlert>;
  if (!tasks.length) return <CanvasEmpty>{emptyMessage ?? (allTasks ? copy.noAllTasks : copy.noTasks)}</CanvasEmpty>;
  return <ul className={`canvas-task-list${compact ? ' canvas-task-list-compact' : ''}`}>{tasks.map(task => <li key={task.id}>
    <span className="canvas-task-symbol" aria-hidden="true">{task.kind === 'exam' ? <FileQuestion size={20} /> : task.kind === 'assignment' ? <ClipboardList size={20} /> : <BookOpen size={20} />}</span>
    <div><p className="canvas-task-kind">{task.kind === 'exam' ? copy.exam : task.kind === 'assignment' ? copy.assignment : copy.lesson}</p><Link href={task.href}>{task.title}</Link>{showCourse && <p className="canvas-muted">{task.courseTitle}</p>}
      <p className="canvas-muted">{task.dueAt ? <time dateTime={task.dueAt}>{copy.due}: {canvasDate(task.dueAt, locale)}</time> : copy.noDue}</p>
      {task.late === true && <p className="canvas-muted"><strong>{copy.submittedLate}</strong> · {copy.lateNote}</p>}</div>
    {!compact && <span className="canvas-status" data-status={task.status}>{['completed', 'approved', 'graded'].includes(task.status) ? copy.completed : task.status === 'submitted' ? copy.submitted : task.status === 'in_review' ? copy.inReview : task.status === 'changes_requested' ? copy.changesRequested : task.status === 'in_progress' ? copy.inProgress : copy.pending}</span>}
  </li>)}</ul>;
}
export function CanvasResults({ results, locale, showCourse = true }: { results: CanvasResult[] | null; locale: string; showCourse?: boolean }) {
  const copy = canvasCopy(locale);
  return <><p className="canvas-muted canvas-result-note">{copy.resultsNote}</p>{results === null ? <CanvasAlert variant="warning">{copy.unavailable}</CanvasAlert> : !results.length ? <CanvasEmpty>{copy.noResults}</CanvasEmpty> : <CanvasResultTable results={results} locale={locale} showCourse={showCourse} />}</>;
}

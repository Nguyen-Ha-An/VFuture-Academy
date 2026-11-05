import Link from 'next/link';
import './learner-routes.css';
import { CanvasAlert, CanvasButton } from '@/features/canvas/ui';
import { calendarMonth, ictDay } from './calendar-model';
import { canvasCopy, canvasDate } from './canvas-copy';
import type { CanvasEvent } from './canvas-model';
import { CanvasEmpty } from './CanvasLearningLists';

export function CanvasCalendar({ month, events, locale, hrefForMonth, now = new Date() }: { month: string; events: CanvasEvent[] | null; locale: string; hrefForMonth: (month: string) => string; now?: Date }) {
  const copy = canvasCopy(locale);
  const model = calendarMonth(month, now);
  const today = ictDay(now.toISOString());
  const title = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(model.first);
  const eventLabel = (kind: string) => kind === 'exam_open' ? copy.examOpens : kind === 'exam_close' ? copy.examCloses : copy.due;
  const sorted = events?.filter(event => ictDay(event.at).startsWith(model.key)).sort((a, b) => a.at.localeCompare(b.at)) ?? [];
  const byDay = new Map<string, CanvasEvent[]>();
  for (const event of sorted) { const key = ictDay(event.at); byDay.set(key, [...(byDay.get(key) ?? []), event]); }
  return <section className="canvas-calendar" aria-label={copy.calendar}>
    <div className="canvas-toolbar canvas-calendar-toolbar"><h2>{title}</h2><div className="canvas-calendar-controls">
      <CanvasButton href={hrefForMonth(model.previous)} variant="outline" size="lg" aria-label={copy.previousMonth}>‹</CanvasButton>
      <CanvasButton href={hrefForMonth(calendarMonth(undefined, now).key)} variant="outline" size="lg">{copy.today}</CanvasButton>
      <CanvasButton href={hrefForMonth(model.next)} variant="outline" size="lg" aria-label={copy.nextMonth}>›</CanvasButton>
    </div></div>
    <p className="canvas-muted">{copy.calendarNote}</p>
    {events === null ? <CanvasAlert variant="warning">{copy.unavailable}</CanvasAlert> : <>
      <table className="canvas-month-grid"><caption className="sr-only">{title}</caption><thead><tr>{copy.weekDays.map(day => <th key={day} scope="col">{day}</th>)}</tr></thead><tbody>{Array.from({ length: model.cells.length / 7 }, (_, week) => <tr key={week}>{model.cells.slice(week * 7, week * 7 + 7).map((day, index) => <td key={day ?? `blank-${index}`} data-today={day === today ? '' : undefined}>
        {day ? <><time className="canvas-day-number" dateTime={day} aria-current={day === today ? 'date' : undefined} aria-label={new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))}>{Number(day.slice(-2))}</time><ul>{byDay.get(day)?.map(event => <li key={event.id} data-event-kind={event.kind}><Link href={event.href}><span>{event.title}</span><time dateTime={event.at}>{eventLabel(event.kind)} · {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(event.at))}</time></Link></li>)}</ul></> : null}
      </td>)}</tr>)}</tbody></table>
      <div className="canvas-agenda"><h3>{copy.agenda}</h3>{sorted.length ? <ul>{sorted.map(event => <li key={event.id} data-event-kind={event.kind}><time dateTime={event.at}>{canvasDate(event.at, locale)}</time><div><Link href={event.href}>{event.title}</Link><p className="canvas-muted">{event.courseTitle} · {eventLabel(event.kind)}</p></div></li>)}</ul> : <CanvasEmpty>{copy.noEvents}</CanvasEmpty>}</div>
      {sorted.length === 0 && <div className="canvas-calendar-desktop-empty"><CanvasEmpty>{copy.noEvents}</CanvasEmpty></div>}
    </>}
  </section>;
}

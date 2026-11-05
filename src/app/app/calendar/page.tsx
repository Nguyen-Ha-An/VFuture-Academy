import { getLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { listLearningCalendar } from '@/features/coursework/service';
import { CanvasCalendar } from '@/features/workspace-ui/learner/CanvasCalendar';
import { calendarMonth } from '@/features/workspace-ui/learner/calendar-model';
import { canvasCopy } from '@/features/workspace-ui/learner/canvas-copy';

export default async function LearnerCalendarPage({ searchParams }: { searchParams?: Promise<{ month?: string }> }) {
  const [user, localeValue, params] = await Promise.all([requireUser(), getLocale(), searchParams ?? Promise.resolve({} as { month?: string })]);
  const locale = localeValue === 'en' ? 'en' : 'vi';
  const month = calendarMonth(params.month);
  const calendar = await listLearningCalendar({ userId: user.id, roles: [] }, { start: month.start, end: month.end, locale }).catch(error => { console.error('[learner calendar] unavailable', error); return null; });
  return <div className="canvas-page canvas-learning"><header className="canvas-page-heading"><h1>{canvasCopy(locale).calendar}</h1></header><CanvasCalendar month={month.key} events={calendar?.events ?? null} locale={locale} hrefForMonth={value => `/app/calendar?month=${encodeURIComponent(value)}`} /></div>;
}

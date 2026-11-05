// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import { CanvasProvider } from '@/features/canvas/ui';
import { CanvasCalendar } from '@/features/workspace-ui/learner/CanvasCalendar';
import { CanvasCourseWorkspace, courseTab } from '@/features/workspace-ui/learner/CanvasCourseWorkspace';
import { CanvasAnnouncements, CanvasResults, CanvasTasks } from '@/features/workspace-ui/learner/CanvasLearningLists';
import { calendarMonth, ictDay } from '@/features/workspace-ui/learner/calendar-model';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Canvas learner month boundaries', () => {
  it('uses ICT month boundaries, Monday columns and valid leap days', () => {
    const month = calendarMonth('2028-02');
    expect(month.start).toBe('2028-01-31T17:00:00.000Z');
    expect(month.end).toBe('2028-02-29T17:00:00.000Z');
    expect(month.cells.filter(Boolean)).toHaveLength(29);
    expect(month.cells[0]).toBeNull();
    expect(month.cells[1]).toBe('2028-02-01');
    expect(ictDay('2028-01-31T18:00:00Z')).toBe('2028-02-01');
  });
  it('normalizes invalid months and crosses year boundaries', () => {
    expect(calendarMonth('2026-13', new Date('2026-11-30T18:00:00Z')).key).toBe('2026-12');
    expect(calendarMonth('2026-01').previous).toBe('2025-12');
    expect(calendarMonth('2026-12').next).toBe('2027-01');
  });
});
describe('Canvas learner views', () => {
  it.each([true, false])('keeps six real course destinations and the selected page with wide navigation=%s', async wide => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') && wide, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    render(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh"><CanvasProvider theme="light"><CanvasCourseWorkspace id="course-a" title="Course A" locale="en" tab="modules" listContext={{ tab: 'discover', level: 'foundation', language: 'en' }} overview="overview content" modules="module content" assignments="assignments" grades="grades" announcements="announcements" calendar="calendar" /></CanvasProvider></NextIntlClientProvider>);
    const trigger = wide ? null : screen.getByRole('button', { name: 'Course navigation' });
    if (trigger) await user.click(trigger);
    const nav = screen.getByRole('navigation', { name: 'Course A' });
    expect(within(nav).getAllByRole('link')).toHaveLength(6);
    expect(within(nav).getByRole('link', { name: 'Modules' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/app/courses/course-a?tab=discover&level=foundation&language=en&view=grades');
    expect(within(nav).getAllByRole('link').every(link => link.getAttribute('href')?.includes('tab=discover&level=foundation&language=en'))).toBe(true);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('module content')).toBeInTheDocument();
    expect(screen.queryByText('overview content')).not.toBeInTheDocument();
    expect(courseTab('invalid')).toBe('overview');
    if (!wide) {
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('module content')).toBeInTheDocument();
    }
  });
  it('shows the exact recorded scores without calculating a total or percentage', () => {
    render(<CanvasResults locale="en" results={[{ id: 'result', title: 'Recorded exam', courseTitle: 'Course A', href: '/app/courses/a/items/e', score: 7.5, maxScore: 10, recordedAt: '2026-11-05T00:00:00Z', status: 'graded' }]} />);
    expect(screen.getByText('7.5 / 10')).toBeInTheDocument();
    expect(screen.queryByText(/75%/)).not.toBeInTheDocument();
    expect(screen.getByText(/A course total is not calculated/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recorded exam' })).toHaveAttribute('href', '/app/courses/a/items/e');
  });
  it.each(['en', 'vi'])('renders announcement text safely and separates failure from empty in %s', locale => {
    const unavailable = locale === 'en' ? 'This information could not be loaded. Please try again.' : 'Không tải được thông tin. Vui lòng thử lại.';
    const empty = locale === 'en' ? 'No announcements have been published.' : 'Chưa có thông báo được đăng.';
    const view = render(<CanvasAnnouncements locale={locale} entries={[{ id: 'a', title: 'Update', body: '<script>unsafe()</script>', publishedAt: '2026-11-05T00:00:00Z' }]} />);
    expect(screen.getByText('<script>unsafe()</script>')).toBeVisible();
    expect(view.container.querySelector('script')).toBeNull();
    view.rerender(<CanvasAnnouncements locale={locale} entries={null} />);
    expect(screen.getByText(unavailable)).toBeVisible();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    view.rerender(<CanvasAnnouncements locale={locale} entries={[]} />);
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByText(unavailable)).not.toBeInTheDocument();
  });
  it('keeps real task links and has a Vietnamese empty state', () => {
    const view = render(<CanvasTasks locale="en" tasks={[{ id: 't', title: 'Task A', href: '/app/courses/a/items/t#block', courseTitle: 'Course A', dueAt: null, status: 'submitted', kind: 'assignment' }]} />);
    expect(screen.getByRole('link', { name: 'Task A' })).toHaveAttribute('href', '/app/courses/a/items/t#block');
    expect(screen.getByText('Submitted')).toBeVisible();
    view.rerender(<CanvasTasks locale="vi" tasks={[]} />);
    expect(screen.getByText('Bạn chưa có nhiệm vụ sắp tới.')).toBeVisible();
  });
  it.each([true, false, null, undefined])('uses the recorded late=%s value without inferring lateness from the deadline', late => {
    render(<CanvasTasks locale="en" tasks={[{ id: 't', title: 'Task A', href: '/app/courses/a/items/t', courseTitle: 'Course A', dueAt: '2020-01-01T00:00:00Z', status: 'submitted', kind: 'assignment', late }]} />);
    expect(screen.queryByText('Submitted late', { exact: true }) !== null).toBe(late === true);
    if (late === true) expect(screen.getByText(/No automatic score penalty/)).toBeVisible();
  });
  it('renders ICT events in both the desktop month and mobile agenda with working month links', () => {
    render(<CanvasCalendar locale="en" month="2026-11" now={new Date('2026-11-05T00:00:00Z')} hrefForMonth={value => `/app/calendar?month=${value}`} events={[{ id: 'e', title: 'Assignment A', courseTitle: 'Course A', href: '/app/courses/a/items/t', at: '2026-10-31T18:00:00Z', kind: 'assignment_due' }]} />);
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute('href', '/app/calendar?month=2026-10');
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute('href', '/app/calendar?month=2026-12');
    expect(screen.getAllByRole('link', { name: /Assignment A/ })).toHaveLength(2);
    const grid = screen.getByRole('table', { name: 'November 2026' });
    expect(within(grid).getByRole('link', { name: /Assignment A/ }).closest('td')?.querySelector('time')).toHaveAttribute('dateTime', '2026-11-01');
  });
});

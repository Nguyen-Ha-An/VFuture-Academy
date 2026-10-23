// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { AdminOverviewView, type AdminOverviewViewProps } from '@/features/admin/ui/AdminOverviewView';

// The chart body loads after hydration; a first paint shows the skeleton.
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => ReactNode }) => function DynamicChart() { return options.loading(); },
}));

afterEach(cleanup);

function days(values: [number, number][]) {
  return values.map(([lessonCompletions, attempts], index) => ({ day: `2026-09-${String(index + 1).padStart(2, '0')}`, lessonCompletions, attempts }));
}

const FULL: AdminOverviewViewProps = {
  eyebrow: 'Central · All schools',
  title: 'Overview',
  description: 'People, learning and content across your management scope.',
  inviteHref: '/admin/users?invite=1',
  kpis: [
    { key: 'members', value: 1240, href: '/admin/users', pendingInvitations: 3 },
    { key: 'activeLearners', value: 120, delta: 20 },
    { key: 'pendingGrading', value: null, href: '/grading/queue' },
    { key: 'pendingReview', value: 4, href: '/studio/reviews' },
  ],
  activity: { state: 'ready', days: days([[2, 1], [0, 0], [5, 4]]) },
  schools: {
    state: 'ready',
    rows: [
      { branchId: 'ans', name: 'Trường An Sương', activeLearners30d: 12, href: '/admin/branches/ans' },
      { branchId: 'dewey', name: 'Dewey', activeLearners30d: 0 },
    ],
  },
  pipeline: [
    { key: 'pending', count: 4, tone: 'warning', href: '/studio/reviews' },
    { key: 'changesRequested', count: 1, tone: 'danger' },
    { key: 'approved', count: 0, tone: 'info' },
    { key: 'pendingGrading', count: null, tone: 'warning', href: '/grading/queue' },
  ],
  recent: {
    state: 'ready',
    items: [
      { id: '1', actor: { kind: 'person', name: 'Nguyễn Minh Anh', avatarUrl: null }, action: 'Invitation revoked', target: 'Invitation', at: '2026-09-24T00:00:00.000Z' },
      { id: '2', actor: { kind: 'system' }, action: 'Role assignment changed', target: 'Member', href: '/admin/users/u-1', at: '2026-09-23T00:00:00.000Z' },
      { id: '3', actor: { kind: 'unknown' }, action: 'School updated', target: 'School', at: '2026-09-22T00:00:00.000Z' },
    ],
  },
  auditHref: '/admin/audit',
};

function renderView(props: AdminOverviewViewProps, locale: 'en' | 'vi' = 'en') {
  const messages = staffUiTestMessages(locale === 'vi' ? vi_ : en, locale);
  return render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" now={new Date('2026-09-25T00:00:00.000Z')}>
    <AdminOverviewView {...props} />
  </NextIntlClientProvider>);
}

describe('AdminOverviewView', () => {
  it('renders the heading with one primary "Invite member" action', () => {
    renderView(FULL);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const invite = screen.getByRole('link', { name: 'Invite member' });
    expect(invite).toHaveAttribute('href', '/admin/users?invite=1');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('hides the invite action without membership.manage', () => {
    renderView({ ...FULL, inviteHref: undefined });
    expect(screen.queryByRole('link', { name: 'Invite member' })).not.toBeInTheDocument();
  });

  it('renders KPIs as a description list with honest values', () => {
    const { container } = renderView(FULL);
    const grid = container.querySelector('dl[data-slot="stat-grid"]')!;
    expect(grid.querySelectorAll('dt')).toHaveLength(4);
    const cards = [...grid.querySelectorAll('[data-slot="stat-card"]')] as HTMLElement[];
    expect(within(cards[0]).getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/admin/users');
    expect(cards[0].querySelector('dd')).toHaveTextContent('1,240');
    expect(cards[0]).toHaveTextContent('3 pending invitations');
    // Short label; the window lives in the hint so the value never drops below its neighbours.
    expect(cards[1]).toHaveTextContent('Active learners');
    expect(cards[1]).toHaveTextContent('Last 30 days');
    expect(cards[1].querySelector('[data-slot="stat-delta"]')).toHaveAttribute('data-direction', 'up');
    expect(cards[1]).toHaveTextContent('vs previous 30 days');
    expect(cards[2]).toHaveAttribute('data-state', 'unavailable');
    expect(cards[2].querySelector('dd')).toHaveTextContent('Unavailable');
    expect(cards[2].querySelector('dd')).not.toHaveTextContent('0');
    expect(within(cards[3]).getByRole('link', { name: 'Waiting for review' })).toHaveAttribute('href', '/studio/reviews');
    // Only the trend card carries a delta.
    expect(grid.querySelectorAll('[data-slot="stat-delta"]')).toHaveLength(1);
  });

  it('says when the pending-invitation count failed instead of showing 0', () => {
    renderView({ ...FULL, kpis: [{ key: 'members', value: 5, pendingInvitations: null }] });
    expect(screen.getByText('Pending invitations unavailable')).toBeInTheDocument();
  });

  it('shows the learning activity chart with an accessible table and a text summary', () => {
    renderView(FULL);
    const chart = screen.getByRole('region', { name: 'Learning activity, 30 days' });
    expect(within(chart).getByRole('table')).toBeInTheDocument();
    expect(within(chart).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Day', 'Lessons completed', 'Quiz and exam attempts']);
    expect(within(chart).getAllByRole('row')).toHaveLength(4);
    expect(chart).toHaveTextContent('In the last 30 days: 7 lessons completed and 5 quiz and exam attempts.');
  });

  it('shows Unavailable for a failed chart read', () => {
    renderView({ ...FULL, activity: { state: 'unavailable' } });
    const chart = screen.getByRole('region', { name: 'Learning activity, 30 days' });
    expect(chart).toHaveTextContent('Chart data could not be loaded.');
    expect(within(chart).queryByRole('table')).not.toBeInTheDocument();
  });

  it('ranks schools by active learners, linking only when the viewer can open schools', () => {
    renderView(FULL);
    const card = screen.getByRole('region', { name: 'Schools by active learners' });
    const items = within(within(card).getByRole('list', { name: 'Schools ranked by active learners' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Trường An Sương12 learners', 'Dewey0 learners']);
    expect(within(items[0]).getByRole('link', { name: 'Trường An Sương' })).toHaveAttribute('href', '/admin/branches/ans');
    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the work pipeline with review states and waiting to grade', () => {
    renderView(FULL);
    const strip = screen.getByRole('region', { name: 'Work waiting' });
    const stages = within(strip).getAllByRole('listitem');
    expect(stages.map((stage) => stage.getAttribute('data-stage'))).toEqual(['pending', 'changesRequested', 'approved', 'pendingGrading']);
    expect(stages[0]).toHaveTextContent('4Waiting for review');
    expect(within(stages[0]).getByRole('link')).toHaveAttribute('href', '/studio/reviews');
    expect(stages[2]).toHaveTextContent('0Approved, not yet published');
    expect(stages[3]).toHaveTextContent('UnavailableWaiting to grade');
  });

  it('anchors on recent activity with actor names and a link to the audit log', () => {
    renderView(FULL);
    const feed = screen.getByRole('region', { name: 'Recent activity' });
    const items = within(feed).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Nguyễn Minh Anh Invitation revoked Invitation');
    expect(items[1]).toHaveTextContent('System Role assignment changed Member');
    expect(within(items[1]).getByRole('link', { name: 'Member' })).toHaveAttribute('href', '/admin/users/u-1');
    expect(items[2]).toHaveTextContent('Unknown user School updated School');
    expect(within(feed).getByRole('link', { name: 'View audit log' })).toHaveAttribute('href', '/admin/audit');
  });

  it('says Unavailable when recent activity failed to load', () => {
    renderView({ ...FULL, recent: { state: 'unavailable' } });
    expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent('Unavailable');
  });

  it('hides every card the viewer may not read', () => {
    const { container } = renderView({ title: 'Overview', kpis: [] });
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('renders Vietnamese labels', () => {
    renderView(FULL, 'vi');
    expect(screen.getByRole('link', { name: 'Mời thành viên' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hoạt động học tập, 30 ngày' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Trường theo số học viên hoạt động' })).toBeInTheDocument();
    expect(screen.getByText('3 lời mời đang chờ')).toBeInTheDocument();
    expect(screen.getByText('Hệ thống')).toBeInTheDocument();
  });
});

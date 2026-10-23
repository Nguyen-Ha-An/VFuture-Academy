// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { withBenchMessages } from '@/messages/bench';
import { LeaderboardBenchHead, LeaderboardBoardView } from '@/features/workspace-ui/profile/LeaderboardBench';
import { LeaderboardBoard } from '@/features/workspace-ui/profile/LeaderboardBoard';

const mocks = vi.hoisted(() => ({ branchIdForUser: vi.fn(), weeklyLeaderboard: vi.fn(), getProfileSettings: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/features/me/service', () => ({ branchIdForUser: mocks.branchIdForUser }));
vi.mock('@/features/xp/service', () => ({ weeklyLeaderboard: mocks.weeklyLeaderboard }));
vi.mock('@/features/profile/service', () => ({ getProfileSettings: mocks.getProfileSettings }));
afterEach(cleanup);

const messages = withBenchMessages(en, 'en');
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh">{node}</NextIntlClientProvider>);
const entries = Array.from({ length: 30 }, (_, index) => ({ rank: index + 1, handle: `learner-${index + 1}`, displayName: `Learner ${index + 1}`, points: 3000 - index * 50 }));

describe('bench leaderboard', () => {
  it('keeps the scope links and marks the active scope', () => {
    wrap(<LeaderboardBenchHead scope="branch" week={9} />);
    expect(screen.getByText('Leaderboard · WK 09')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeVisible();
    const scope = screen.getByRole('navigation', { name: 'Leaderboard scope' });
    expect(within(scope).getByRole('link', { name: 'Global' })).toHaveAttribute('href', '/app/leaderboard?scope=global');
    expect(within(scope).getByRole('link', { name: 'My branch' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Resets Mon 00:00 ICT')).toBeVisible();
    expect(scope).toHaveClass('vf-seg');
    expect(screen.getByRole('heading', { level: 1 }).closest('.vf-page-head')).toBeInTheDocument();
  });

  it('renders the top 10, a gap row and the viewer ±3 with the viewer marked', () => {
    const { container } = wrap(<LeaderboardBoardView entries={entries} viewer={{ handle: 'learner-23', profilePublic: true }} />);
    const table = screen.getByRole('table', { name: 'Weekly XP leaderboard' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Rank', 'Learner', 'XP']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(18);
    expect(container.querySelectorAll('tr[data-gap]')).toHaveLength(1);
    const current = container.querySelector('tr[aria-current="true"]');
    expect(current).toHaveTextContent('#23');
    expect(within(current as HTMLElement).getByText('You')).toBeVisible();
    expect(screen.getByText('30 learners this week')).toBeVisible();
    expect(screen.getByText('You · #23')).toBeVisible();
  });

  it('adds a no-XP row for a viewer who has not earned XP this week', () => {
    const { container } = wrap(<LeaderboardBoardView entries={entries.slice(0, 12)} viewer={{ handle: 'quiet-learner', profilePublic: true }} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(11);
    const current = container.querySelector('tr[aria-current="true"]') as HTMLElement;
    expect(current).toHaveTextContent('You · no XP this week');
    expect(current).toHaveTextContent('Complete any lesson to enter');
  });

  it('shows an empty bench when nobody has XP this week', () => {
    wrap(<LeaderboardBoardView entries={[]} viewer={{ handle: 'learner-1', profilePublic: true }} />);
    expect(screen.getByRole('heading', { name: 'No one has earned XP this week yet' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Browse courses/ })).toHaveAttribute('href', '/app/courses');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('formats points with the active locale', () => {
    const board = [{ rank: 1, handle: 'a', displayName: 'A', points: 12500 }];
    const english = wrap(<LeaderboardBoardView entries={board} viewer={{ handle: 'a', profilePublic: true }} />);
    expect(screen.getByText('12,500')).toBeVisible();
    english.unmount();
    render(<NextIntlClientProvider locale="vi" messages={withBenchMessages(viMessages, 'vi')} timeZone="Asia/Ho_Chi_Minh"><LeaderboardBoardView entries={board} viewer={{ handle: 'a', profilePublic: true }} /></NextIntlClientProvider>);
    expect(screen.getByText('12.500')).toBeVisible();
  });

  it('keeps the existing no-branch copy', () => {
    wrap(<LeaderboardBoardView entries={[]} viewer={{ handle: null, profilePublic: false }} noBranch />);
    expect(screen.getByText('Your profile is not assigned to a branch.')).toBeVisible();
  });
});

describe('bench leaderboard loader', () => {
  it('identifies the viewer by handle and loads the branch board', async () => {
    mocks.branchIdForUser.mockResolvedValue('hcm');
    mocks.weeklyLeaderboard.mockResolvedValue(entries.slice(0, 5));
    mocks.getProfileSettings.mockResolvedValue({ handle: 'learner-3', displayName: 'Learner 3', profilePublic: true });
    const { container } = wrap(await LeaderboardBoard({ scope: 'branch', userId: 'user-1' }));
    expect(mocks.weeklyLeaderboard).toHaveBeenCalledWith('branch', 'hcm');
    expect(container.querySelector('tr[aria-current="true"]')).toHaveTextContent('#3');
  });

  it('falls back to the no-branch state without querying the board', async () => {
    mocks.weeklyLeaderboard.mockClear();
    mocks.branchIdForUser.mockResolvedValue(null);
    wrap(await LeaderboardBoard({ scope: 'branch', userId: 'user-1' }));
    expect(mocks.weeklyLeaderboard).not.toHaveBeenCalled();
    expect(screen.getByText('Your profile is not assigned to a branch.')).toBeVisible();
  });
  it('adds a rank-change column only when last week loaded', () => {
    const board = [
      { rank: 1, handle: 'climber', displayName: 'Climber', points: 300 },
      { rank: 2, handle: 'steady', displayName: 'Steady', points: 200 },
      { rank: 3, handle: 'newcomer', displayName: 'Newcomer', points: 100 },
    ];
    const { container } = wrap(<LeaderboardBoardView entries={board} viewer={{ handle: 'steady', profilePublic: true }} previousRanks={{ climber: 4, steady: 2 }} />);
    const rows = [...container.querySelectorAll('tbody tr')].map(row => row.lastElementChild?.textContent);
    expect(container.querySelectorAll('thead th')).toHaveLength(4);
    expect(rows[0]).toContain('▲ 3');
    expect(rows[1]).toContain('·');
    expect(rows[2]).toContain('new');
  });
  it('omits the change column without last week', () => {
    const { container } = wrap(<LeaderboardBoardView entries={[{ rank: 1, handle: 'a', displayName: 'A', points: 5 }]} viewer={{ handle: 'a', profilePublic: true }} />);
    expect(container.querySelectorAll('thead th')).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';

import { leaderboardRows, type LeaderboardEntry, type LeaderboardRow } from '@/features/workspace-ui/profile/leaderboard-rows';

function board(count: number): LeaderboardEntry[] {
  return Array.from({ length: count }, (_, index) => ({ rank: index + 1, handle: `learner-${index + 1}`, displayName: `Learner ${index + 1}`, points: 1000 - index }));
}

/** Compact picture of the rows: ranks, `…` for a gap, `you` for the viewer-unranked row, `*` marks the viewer. */
function shape(rows: LeaderboardRow[]) {
  return rows.map((row) => row.kind === 'gap' ? '…' : row.kind === 'unranked' ? `you:${row.reason}` : `${row.entry.rank}${row.viewer ? '*' : ''}`);
}

const viewerAt = (rank: number) => ({ handle: `learner-${rank}`, profilePublic: true });

describe('leaderboardRows', () => {
  it('reports an empty board when nobody has XP this week', () => {
    expect(leaderboardRows([], viewerAt(1))).toEqual({ rows: [], viewerRank: null, empty: true });
  });

  it('shows everyone in a branch with fewer than 10 learners', () => {
    const slice = leaderboardRows(board(6), viewerAt(4));
    expect(shape(slice.rows)).toEqual(['1', '2', '3', '4*', '5', '6']);
    expect(slice.viewerRank).toBe(4);
  });

  it('keeps the top 10 when the viewer ranks near the top', () => {
    expect(shape(leaderboardRows(board(40), viewerAt(2)).rows)).toEqual(['1', '2*', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('renders one contiguous list down to viewer+3 for ranks 11 to 13', () => {
    const slice = leaderboardRows(board(40), viewerAt(13));
    expect(shape(slice.rows)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13*', '14', '15', '16']);
    expect(slice.rows.some((row) => row.kind === 'gap')).toBe(false);
  });

  it('never draws a gap row that hides nothing (rank 14 window starts at 11)', () => {
    const rows = shape(leaderboardRows(board(40), viewerAt(14)).rows);
    expect(rows).not.toContain('…');
    expect(rows.at(-1)).toBe('17');
  });

  it('shows top 10, a gap, then the viewer ±3 further down', () => {
    const slice = leaderboardRows(board(40), viewerAt(23));
    expect(shape(slice.rows)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '…', '20', '21', '22', '23*', '24', '25', '26']);
    expect(slice.viewerRank).toBe(23);
  });

  it('clips the neighbour window at the bottom of the board', () => {
    expect(shape(leaderboardRows(board(20), viewerAt(20)).rows).slice(-5)).toEqual(['…', '17', '18', '19', '20*']);
  });

  it('adds a "no XP this week" row under the top 10 for a public viewer with no XP', () => {
    const slice = leaderboardRows(board(30), { handle: 'someone-else', profilePublic: true });
    expect(shape(slice.rows)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'you:no-xp']);
    expect(slice.viewerRank).toBeNull();
  });

  it('explains a private viewer instead of claiming they have no XP', () => {
    expect(shape(leaderboardRows(board(3), { handle: null, profilePublic: false }).rows)).toEqual(['1', '2', '3', 'you:private']);
  });

  it('orders by rank even when the loader returns rows out of order', () => {
    expect(shape(leaderboardRows([...board(3)].reverse(), viewerAt(1)).rows)).toEqual(['1*', '2', '3']);
  });
});

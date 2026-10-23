export type LeaderboardEntry = {
  rank: number;
  handle: string | null;
  displayName: string;
  points: number;
};

export type LeaderboardViewer = {
  handle: string | null;
  /** Private profiles never appear in the weekly board (the RPC filters on `profile_public`). */
  profilePublic: boolean;
};

export type LeaderboardRow =
  | { kind: 'entry'; entry: LeaderboardEntry; viewer: boolean }
  | { kind: 'gap' }
  | { kind: 'unranked'; reason: 'no-xp' | 'private' };

export type LeaderboardSlice = {
  rows: LeaderboardRow[];
  /** 1-based position of the viewer in the board, or null when they are not listed. */
  viewerRank: number | null;
  /** True when nobody has XP this week; the view renders an empty bench instead of rows. */
  empty: boolean;
};

const TOP = 10;
const RADIUS = 3;

function viewerIndex(entries: readonly LeaderboardEntry[], viewer: LeaderboardViewer): number {
  if (!viewer.handle) return -1;
  return entries.findIndex((entry) => entry.handle === viewer.handle);
}

/**
 * Slices the weekly board to the top 10 plus the viewer ±3 (spec 4.7 / 4.12).
 * - Fewer than 10 learners: everyone.
 * - Viewer inside or adjacent to the top block (position ≤ 14): one contiguous list down to viewer+3.
 *   A gap row is drawn only when it actually hides rows, so rank 14 (window 11–17) stays contiguous.
 * - Otherwise: top 10, a gap row, then the viewer ±3.
 * - Viewer not listed: top 10, then a "You" row explaining why (no XP, or a private profile).
 */
export function leaderboardRows(entries: readonly LeaderboardEntry[], viewer: LeaderboardViewer): LeaderboardSlice {
  const sorted = [...entries].sort((left, right) => left.rank - right.rank);
  if (sorted.length === 0) return { rows: [], viewerRank: null, empty: true };

  const index = viewerIndex(sorted, viewer);
  const entryRow = (entry: LeaderboardEntry, position: number): LeaderboardRow => ({ kind: 'entry', entry, viewer: position === index });

  if (index < 0) {
    const rows = sorted.slice(0, TOP).map(entryRow);
    rows.push({ kind: 'unranked', reason: viewer.profilePublic ? 'no-xp' : 'private' });
    return { rows, viewerRank: null, empty: false };
  }

  const windowStart = Math.max(0, index - RADIUS);
  const windowEnd = Math.min(sorted.length, index + RADIUS + 1);

  if (windowStart <= TOP) {
    const end = Math.max(Math.min(TOP, sorted.length), windowEnd);
    return { rows: sorted.slice(0, end).map(entryRow), viewerRank: index + 1, empty: false };
  }

  return {
    rows: [
      ...sorted.slice(0, TOP).map(entryRow),
      { kind: 'gap' },
      ...sorted.slice(windowStart, windowEnd).map((entry, offset) => entryRow(entry, windowStart + offset)),
    ],
    viewerRank: index + 1,
    empty: false,
  };
}

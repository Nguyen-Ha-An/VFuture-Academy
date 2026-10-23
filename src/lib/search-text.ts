/**
 * Diacritic-insensitive matching for the command menus (staff and learner), so "duyet" finds
 * "Duyệt nội dung" and "khoa hoc" finds "Khoá học". Kept free of React and cmdk so a shell can
 * import it without pulling the dialog chunk.
 */

/** Lowercases, strips combining marks (NFD) and folds đ/Đ, which Unicode does not decompose. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  const normalized = normalizeSearchText(text);
  return normalized ? normalized.split(' ') : [];
}

/**
 * Scores `query` against candidate strings (label first, then keywords such as
 * the other locale's label). Every query token must appear somewhere in the
 * candidates. Returns 0 for no match, otherwise a cmdk-compatible rank in (0, 1]:
 * 1 when the first candidate starts with the query, 0.75 when every token starts
 * a word, 0.5 for a plain substring match.
 */
export function searchScore(query: string, candidates: readonly string[]): number {
  const wanted = tokens(query);
  if (wanted.length === 0) return 1;
  const normalized = candidates.map(normalizeSearchText).filter(Boolean);
  if (normalized.length === 0) return 0;
  const haystack = normalized.join(' ');
  if (!wanted.every((token) => haystack.includes(token))) return 0;
  if (normalized[0].startsWith(wanted.join(' '))) return 1;
  const words = haystack.split(' ');
  if (wanted.every((token) => words.some((word) => word.startsWith(token)))) return 0.75;
  return 0.5;
}

export function matchesSearch(query: string, candidates: readonly string[]): boolean {
  return searchScore(query, candidates) > 0;
}

/**
 * cmdk `filter` prop. Items pass an opaque unique `value` (never matched, it may
 * hold English ids) and put the human text in `keywords`, label first.
 */
export function commandFilter(_value: string, search: string, keywords?: string[]): number {
  return searchScore(search, keywords ?? []);
}

/** Session-scoped review settings; this module is test-only and never changes production URLs. */
export type SupportReviewKey = 'supportState' | 'supportMutation' | 'lang' | 'theme';
const prefix = 'academy-support-review:';
export function supportReviewParam(key: SupportReviewKey): string | null {
  const query = new URLSearchParams(location.search);
  try {
    if (query.get('supportState') === 'baseline') {
      sessionStorage.removeItem(`${prefix}supportState`);
      sessionStorage.removeItem(`${prefix}supportMutation`);
    }
    for (const name of ['supportState', 'supportMutation', 'lang', 'theme'] as const) {
      const value = query.get(name);
      if (value !== null && !(name === 'supportState' && value === 'baseline')) sessionStorage.setItem(`${prefix}${name}`, value);
    }
    const explicit = query.get(key);
    if (explicit !== null) {
      if (!(key === 'supportState' && explicit === 'baseline')) sessionStorage.setItem(`${prefix}${key}`, explicit);
      return explicit;
    }
    return sessionStorage.getItem(`${prefix}${key}`);
  } catch { return query.get(key); }
}

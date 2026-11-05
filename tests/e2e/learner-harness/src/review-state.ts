import { supportReviewParam } from '../../support/support-review-state';
/** Test-only scenario continuity through unchanged production link URLs. */
export type LearnerReviewKey = 'fixture' | 'longName' | 'lang' | 'theme';
const prefix = 'academy-learner-review:';
export function learnerReviewParam(key: LearnerReviewKey): string | null {
  if (key === 'lang' || key === 'theme') return supportReviewParam(key);
  const query = new URLSearchParams(location.search);
  try {
    if (query.get('fixture') === 'baseline') {
      sessionStorage.removeItem(`${prefix}fixture`);
      sessionStorage.removeItem(`${prefix}longName`);
    }
    for (const name of ['fixture', 'longName'] as const) {
      const value = query.get(name);
      if (value !== null && !(name === 'fixture' && value === 'baseline')) sessionStorage.setItem(`${prefix}${name}`, value);
    }
    const explicit = query.get(key);
    return explicit !== null ? explicit : sessionStorage.getItem(`${prefix}${key}`);
  } catch { return query.get(key); }
}

/**
 * Enrolment handoff across `router.refresh()`: the enrol button records the course, and the course
 * CTA takes it once the refreshed page renders, whether the CTA stayed mounted or remounted.
 */
export const AFTER_ENROLL_KEY = 'vf:after-enroll';

export function markEnrollHandoff(courseId: string) {
  try { sessionStorage.setItem(AFTER_ENROLL_KEY, courseId); } catch { /* storage blocked: focus still follows in place */ }
}

/** True once for the course that was just enrolled; clears the mark. */
export function takeEnrollHandoff(courseId: string): boolean {
  try {
    if (sessionStorage.getItem(AFTER_ENROLL_KEY) !== courseId) return false;
    sessionStorage.removeItem(AFTER_ENROLL_KEY);
    return true;
  } catch {
    return false;
  }
}

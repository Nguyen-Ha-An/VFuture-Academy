export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Back links may only return to a grading queue, an assessment list or a report — never to an
 * arbitrary internal path, which would let a crafted `?back=` aim a trusted in-app link at an
 * action route such as `/auth/signout`.
 *
 * Canonical `/grading/**` destinations and the pre-split `/studio` and `/admin` sources that
 * redirect to them are both listed. Add a destination here when a new queue or report page
 * appears; nothing outside this list is ever accepted.
 */
const BACK_DESTINATIONS: readonly string[] = [
  // Canonical assessment-workspace destinations.
  '/grading',
  '/grading/queue',
  '/grading/assessments',
  '/grading/reports',
  // Pre-split sources that still redirect one-way to the destinations above, so a back link
  // captured before the workspace split keeps working.
  '/studio/grading',
  '/studio/assessments',
  '/studio/submissions',
  '/studio/exams',
  '/studio/analytics',
  '/admin/submissions',
  '/admin/exams',
  '/admin/analytics',
];

/**
 * Accepts a same-origin back link whose path is exactly one of the allowed destinations, keeping
 * its query string. Rejects absolute URLs, protocol-relative `//host`, backslashes and encoded
 * path separators, so no encoded form can smuggle a different destination past the allowlist.
 */
export function safeInternalHref(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.includes('\\')) return null;
  if (/%2f|%5c/i.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, 'http://internal.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'http://internal.invalid') return null;
  if (!BACK_DESTINATIONS.includes(parsed.pathname)) return null;
  // Rebuilt from the parsed parts so no fragment or stray prefix survives into the href.
  return `${parsed.pathname}${parsed.search}`;
}

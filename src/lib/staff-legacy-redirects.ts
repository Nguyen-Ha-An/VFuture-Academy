/**
 * One-way redirects from superseded staff bookmarks to the canonical workspace
 * destination. They resolve before a workspace layout can reject a role that no
 * longer belongs to that workspace. No destination is also a source, so a
 * bookmark never chains or loops, and path parameters and query strings survive.
 */
export type StaffLegacyRedirect = {
  source: string;
  destination: string;
  permanent: false;
};

const contentAreas = ['bank', 'resources', 'opportunities', 'projects'] as const;

const moves: ReadonlyArray<readonly [string, string]> = [
  // Content authoring and review consolidated in Studio.
  ['/admin/cms', '/studio/library'],
  ['/admin/reviews', '/studio/reviews'],
  // Assessment & grading owns assessments, queues, workbenches and reports.
  ['/studio/grading', '/grading/queue'],
  ['/studio/grading/assignments/:id', '/grading/assignments/:id'],
  ['/studio/grading/exams/:id', '/grading/exams/:id'],
  ['/studio/submissions', '/grading/queue'],
  ['/studio/assessments', '/grading/assessments'],
  ['/studio/exams', '/grading/assessments'],
  ['/studio/analytics', '/grading/reports'],
  ['/admin/submissions', '/grading/queue'],
  ['/admin/exams', '/grading/assessments'],
  ['/admin/analytics', '/grading/reports'],
  // People, schools, roles, enrollment versions and audit belong to Administration.
  ['/studio/enrollment-migration', '/admin/enrollment-migration'],
  ['/studio/audit', '/admin/audit'],
  ['/studio/branches', '/admin/branches'],
  ['/studio/users', '/admin/users'],
];

export const staffLegacyRedirects: readonly StaffLegacyRedirect[] = [
  ...contentAreas.map((area) => ({
    source: `/admin/${area}/:path*`,
    destination: `/studio/${area}/:path*`,
    permanent: false as const,
  })),
  ...moves.map(([source, destination]) => ({ source, destination, permanent: false as const })),
];

/** Existing name retained for the Next.js configuration entry point. */
export const studioLegacyRedirects = staffLegacyRedirects;

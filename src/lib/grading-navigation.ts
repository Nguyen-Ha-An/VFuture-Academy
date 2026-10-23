import type { Permission } from '@/lib/authorization';
import { routes } from '@/lib/routes';

/**
 * Assessment & grading (`Khảo thí & đánh giá`) holds assessments, the grading
 * queues/workbenches and learning reports together. Entry never requires
 * `admin.access`, so grader-only and report-only operators reach their own work.
 */
export const gradingNavigation = [
  { key: 'home', href: routes.grading.dashboard(), permissions: ['exam.release', 'submission.grade', 'report.branch.read', 'report.global.read', 'analytics.branch.read', 'analytics.global.read'], available: true, landing: false },
  { key: 'assessments', href: routes.grading.assessments(), permissions: ['exam.release', 'submission.grade'], available: true, landing: true },
  { key: 'queue', href: routes.grading.queue(), permissions: ['submission.grade'], available: true, landing: true,
    // Workbenches open from the queue; keep the queue highlighted while grading one.
    matches: [{ href: '/grading/assignments' }, { href: '/grading/exams' }] },
  { key: 'reports', href: routes.grading.reports(), permissions: ['report.branch.read', 'report.global.read', 'analytics.branch.read', 'analytics.global.read'], available: true, landing: true },
] as const;

/**
 * A grader lands on the active queue; a report-only operator lands on reports.
 * The sidebar keeps assessments first for operators who do both jobs.
 */
export function firstGradingDestination(permissions: readonly Permission[]): string | null {
  if (permissions.includes('submission.grade')) return routes.grading.queue();
  return gradingNavigation.find(item => item.landing && item.permissions.some(permission => permissions.includes(permission)))?.href ?? null;
}

import 'server-only';

import { assignedCourses, assertCourseTeaching } from '@/features/teaching/assignments';
import { ApiError } from '@/lib/api';
import { cookies } from 'next/headers';
import { adminPageContext } from '@/features/admin/context';
import { gradingPageContext, studioPageContext } from '@/features/workspace/context';
import { ADMIN_SCOPE_COOKIE, scopeKey } from '@/lib/admin-scope';
import { buildSchoolNavigation, teachingDestination, schoolTargetWorkspace, type SchoolNavigationRequest } from './school-navigation';

/** Resolve the destination workspace independently of the source page's active school. */
export async function schoolNavigationFor(target: SchoolNavigationRequest) {
  const workspace = schoolTargetWorkspace(target);
  const context = workspace === 'admin' ? await adminPageContext()
    : workspace === 'grading' ? await gradingPageContext() : await studioPageContext();
  if (target.target === 'teaching') {
    const assigned = await assignedCourses(context.actor);
    if (!assigned.courses.some(course => course.courseId === target.courseId && course.branchId === target.branchId)) return null;
    const option = context.options.find(candidate => scopeKey(candidate.scope) === scopeKey({ kind: 'branch', branchId: target.branchId }));
    const selected = option && teachingDestination(option.permissions);
    if (!selected) return null;
    try { await assertCourseTeaching(context.actor, selected.permission, target.courseId, target.branchId); }
    catch (error) { if (error instanceof ApiError && error.status === 403) return null; throw error; }
  }
  const savedScopeKey = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value ?? null;
  return buildSchoolNavigation(context, target, savedScopeKey);
}

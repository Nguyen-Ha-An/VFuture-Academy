import 'server-only';
import { ApiError } from '@/lib/api';
import { can, type Actor, type BranchScopedPermission } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { AssignedCoursesSchema, CourseTeachersSchema, TeacherOptionsSchema, TeachingCourseScopeSchema, type ReplaceCourseTeachers, type TeachingCourseScope } from './assignment-contracts';

/** Map expected SQL failures without exposing database messages or row details. */
function assignmentFailure(error: { code?: string } | null): void {
  if (!error) return;
  if (error.code === '42501') throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (error.code === '40001') throw new ApiError(409, 'STALE_TEACHER_ASSIGNMENTS', 'Teacher assignments changed. Reload and try again.');
  if (error.code === 'P0002' || error.code === '23503') throw new ApiError(404, 'TEACHING_NOT_FOUND', 'Course not found for this school');
  if (error.code === '22023' || error.code === '22P02') throw new ApiError(400, 'INVALID_TEACHERS', 'Choose active teachers with teaching access in this school');
  throw new ApiError(503, 'TEACHING_UNAVAILABLE', 'Teacher assignments are unavailable');
}

/** Database resolves fresh account, memberships, capabilities and exact assignments. */
export async function teachingCourseScope(actor: Actor, permission: BranchScopedPermission): Promise<TeachingCourseScope> {
  const result = await supabaseService().rpc('teaching_course_scope', { p_actor_id: actor.userId, p_permission: permission });
  assignmentFailure(result.error);
  return TeachingCourseScopeSchema.parse(result.data);
}

export async function assertCourseTeaching(actor: Actor, permission: BranchScopedPermission, courseId: string, branchId: string | null): Promise<void> {
  // Preserve the operation permission independently of assignment management.
  if (!can(actor, permission, branchId === null ? { kind: 'central' } : { kind: 'branch', branchId })) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  const scope = await teachingCourseScope(actor, permission);
  if (scope.all || branchId !== null && (scope.branchIds.includes(branchId)
    || scope.assignments.some(pair => pair.courseId === courseId && pair.branchId === branchId))) return;
  throw new ApiError(403, 'FORBIDDEN', 'This course is not assigned to you');
}

/** Omit branchId for learner read: SQL resolves the enrollment's historical school. */
export async function getCourseTeachers(actor: Actor, courseId: string, branchId?: string) {
  const result = await supabaseService().rpc('teaching_course_teachers', { p_actor_id: actor.userId, p_course_id: courseId, p_branch_id: branchId ?? null });
  assignmentFailure(result.error);
  return CourseTeachersSchema.parse(result.data);
}

export async function replaceCourseTeachers(actor: Actor, courseId: string, input: ReplaceCourseTeachers) {
  const result = await supabaseService().rpc('replace_course_teachers', {
    p_actor_id: actor.userId, p_course_id: courseId, p_branch_id: input.branchId,
    p_expected_revision: input.expectedRevision, p_teachers: input.teachers,
  });
  assignmentFailure(result.error);
  return CourseTeachersSchema.parse(result.data);
}

export async function teacherOptions(actor: Actor, branchId: string, page = 1, pageSize = 100) {
  const result = await supabaseService().rpc('teaching_teacher_options', { p_actor_id: actor.userId, p_branch_id: branchId, p_page: page, p_page_size: pageSize });
  assignmentFailure(result.error);
  return TeacherOptionsSchema.parse(result.data);
}

export async function assignedCourses(actor: Actor, locale: 'vi' | 'en' = 'vi') {
  const result = await supabaseService().rpc('teaching_assigned_courses', { p_actor_id: actor.userId, p_locale: locale });
  assignmentFailure(result.error);
  return AssignedCoursesSchema.parse(result.data);
}

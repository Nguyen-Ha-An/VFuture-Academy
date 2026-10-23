import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  branchCanAccess,
  databaseFailure,
  loadBranchId,
  recordOf,
  recordsOf,
  type LearnerDatabase,
} from '@/features/learning/shared';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';

function enrollmentResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseVersionId: row.course_version_id,
    status: row.status,
    enrolledAt: row.enrolled_at,
    completedAt: row.completed_at ?? null,
  };
}

function uniqueViolation(error: unknown): boolean {
  return recordOf(error)?.code === '23505';
}

function isEnrolled(row: Record<string, unknown>): boolean {
  return row.status === 'active' || row.status === 'completed';
}

function enrollmentConflict(): never {
  throw new ApiError(409, 'ENROLLMENT_CONFLICT', 'Enrollment changed during re-enrollment');
}

async function findEnrollment(database: LearnerDatabase, actor: Actor, courseId: string) {
  const result = await database.from('enrollments')
    .select('id,user_id,course_id,course_version_id,status,enrolled_at,completed_at,branch_id,branch_scope_known')
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(result.error, 'Enrollment could not be loaded');
  return recordOf(result.data);
}

async function requireVersionEligibility(
  database: LearnerDatabase,
  actor: Actor,
  courseId: string,
  versionId: string,
  branchId: string | null,
  preservedPin: boolean,
) {
  const outlineResult = await database.from('course_version_outline')
    .select('version_id,course_id,access')
    .eq('version_id', versionId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(outlineResult.error, 'Course access could not be loaded');
  const outline = recordOf(outlineResult.data);
  if (!outline || !branchCanAccess(outline.access, branchId)) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
  }

  const versionResult = await database.from('course_versions')
    .select('id,manifest')
    .eq('id', versionId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(versionResult.error, 'Course version could not be loaded');
  const manifest = recordOf(recordOf(versionResult.data)?.manifest);
  if (!manifest) {
    if (preservedPin) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
    throw new ApiError(409, 'NOT_PUBLISHED', 'Published course version is unavailable');
  }
  if (manifest.enrollment === 'invite') {
    throw new ApiError(403, 'INVITE_ONLY', 'This course requires an invitation');
  }

  const prerequisites = Array.isArray(manifest.prerequisites)
    ? manifest.prerequisites.flatMap((value) => {
      const prerequisite = recordOf(value);
      return prerequisite?.type === 'course_completion' && typeof prerequisite.courseId === 'string'
        ? [prerequisite.courseId]
        : [];
    })
    : [];
  if (prerequisites.length === 0) return;
  const completionResult = await database.from('course_completions')
    .select('course_id')
    .eq('user_id', actor.userId)
    .in('course_id', prerequisites);
  databaseFailure(completionResult.error, 'Prerequisites could not be checked');
  const completed = new Set(recordsOf(completionResult.data).flatMap((row) =>
    typeof row.course_id === 'string' ? [row.course_id] : []));
  const missing = prerequisites.filter((prerequisite) => !completed.has(prerequisite));
  if (missing.length > 0) {
    throw new ApiError(
      409,
      'PREREQ_MISSING',
      'One or more course prerequisites are incomplete',
      missing.map((id) => ({ path: ['prerequisites', id], message: 'Required course is incomplete' })),
    );
  }
}

async function reactivateDroppedEnrollment(
  database: LearnerDatabase,
  actor: Actor,
  courseId: string,
  dropped: Record<string, unknown>,
) {
  if (
    dropped.status !== 'dropped'
    || typeof dropped.id !== 'string'
    || dropped.user_id !== actor.userId
    || dropped.course_id !== courseId
    || typeof dropped.course_version_id !== 'string'
  ) enrollmentConflict();
  const status = typeof dropped.completed_at === 'string' ? 'completed' : 'active';
  const updateResult = await database.from('enrollments')
    .update({ status })
    .eq('id', dropped.id)
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .eq('course_version_id', dropped.course_version_id)
    .eq('status', 'dropped')
    .select('id,user_id,course_id,course_version_id,status,enrolled_at,completed_at')
    .maybeSingle();
  databaseFailure(updateResult.error, 'Enrollment could not be reactivated');
  const updated = recordOf(updateResult.data);
  if (updated && isEnrolled(updated)) return enrollmentResult(updated);

  const raced = await findEnrollment(database, actor, courseId);
  if (raced && isEnrolled(raced)) return enrollmentResult(raced);
  enrollmentConflict();
}

export async function enroll(actor: Actor, courseId: string) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const courseResult = await database.from('courses')
    .select('id,status,current_version_id')
    .eq('id', courseId)
    .maybeSingle();
  databaseFailure(courseResult.error, 'Course could not be loaded');
  const course = recordOf(courseResult.data);
  if (!course || course.status !== 'published' || typeof course.current_version_id !== 'string') {
    throw new ApiError(409, 'NOT_PUBLISHED', 'Course is not published');
  }
  const versionId = course.current_version_id;

  const existing = await findEnrollment(database, actor, courseId);
  if(existing)await assertEnrollmentMembershipAccess(actor,existing,database);
  if (existing && isEnrolled(existing)) return enrollmentResult(existing);
  if (existing && existing.status !== 'dropped') enrollmentConflict();

  const branchId = await loadBranchId(database, actor.userId);
  await assertEnrollmentMembershipAccess(actor,{branch_scope_known:branchId!==null,branch_id:branchId},database);
  await requireVersionEligibility(database, actor, courseId, versionId, branchId, false);

  const reactivate = async (dropped: Record<string, unknown>) => {
    const pinnedVersionId = typeof dropped.course_version_id === 'string'
      ? dropped.course_version_id
      : null;
    if (!pinnedVersionId) enrollmentConflict();
    if (pinnedVersionId !== versionId) {
      await requireVersionEligibility(database, actor, courseId, pinnedVersionId, branchId, true);
    }
    return reactivateDroppedEnrollment(database, actor, courseId, dropped);
  };

  if (existing) return reactivate(existing);

  const insertResult = await database.from('enrollments')
    .insert({
      user_id: actor.userId,
      course_id: courseId,
      course_version_id: versionId,
      status: 'active',
    })
    .select('id,user_id,course_id,course_version_id,status,enrolled_at,completed_at')
    .single();
  if (uniqueViolation(insertResult.error)) {
    const raced = await findEnrollment(database, actor, courseId);
    if (raced && isEnrolled(raced)) return enrollmentResult(raced);
    if (raced?.status === 'dropped') {
      return reactivate(raced);
    }
    if (raced) enrollmentConflict();
  }
  databaseFailure(insertResult.error, 'Enrollment could not be created');
  const inserted = recordOf(insertResult.data);
  if (!inserted) throw new ApiError(500, 'LEARNING_DATABASE_ERROR', 'Enrollment could not be created');
  return enrollmentResult(inserted);
}

import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';

type Database = ReturnType<typeof supabaseService>;
type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const unavailable = (): never => { throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Assessment attachment access could not be checked'); };

async function hasSameCourseEnrollment(database: Database, ownerId: string, versionId: string): Promise<boolean> {
  const result = await database.from('course_versions').select('course_id').eq('id', versionId).maybeSingle();
  if (result.error) return unavailable();
  const version = row(result.data);
  if (typeof version?.course_id !== 'string') return false;
  const enrolled = await database.from('enrollments').select('course_id').eq('user_id', ownerId).eq('course_id', version.course_id).in('status', ['active', 'completed']).maybeSingle();
  if (enrolled.error) return unavailable();
  return row(enrolled.data)?.course_id === version.course_id;
}

/** Null means this is not an assessment-bound asset and existing media policy applies. */
export async function checkBoundAssessmentOwnerAccess(database: Database, actor: Actor, assetId: string): Promise<boolean | null> {
  const examResult = await database.from('exam_attachment_bindings').select('owner_id,attempt_id').eq('asset_id', assetId).maybeSingle();
  if (examResult.error) return unavailable();
  const exam = row(examResult.data);
  if (exam) {
    if (exam.owner_id !== actor.userId || typeof exam.attempt_id !== 'string') return false;
    const result = await database.from('exam_attempts').select('user_id,course_version_id,branch_id,branch_scope_known').eq('id', exam.attempt_id).maybeSingle();
    if (result.error) return unavailable();
    const attempt = row(result.data);
    if (!attempt || attempt.user_id !== actor.userId || typeof attempt.course_version_id !== 'string') return false;
    if (!await hasSameCourseEnrollment(database, actor.userId, attempt.course_version_id)) return false;
    await assertEnrollmentMembershipAccess(actor, attempt, database as unknown as MembershipAccessDatabase);
    return true;
  }
  const quizResult = await database.from('quiz_attachment_bindings').select('owner_id,course_version_id,branch_id,branch_scope_known').eq('asset_id', assetId).maybeSingle();
  if (quizResult.error) return unavailable();
  const quiz = row(quizResult.data);
  if (!quiz) return null;
  if (quiz.owner_id !== actor.userId || typeof quiz.course_version_id !== 'string') return false;
  if (!await hasSameCourseEnrollment(database, actor.userId, quiz.course_version_id)) return false;
  await assertEnrollmentMembershipAccess(actor, quiz, database as unknown as MembershipAccessDatabase);
  return true;
}

import 'server-only';
import { resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';
import { databaseFailure, recordOf, recordsOf, type LearnerDatabase } from '@/features/learning/shared';
import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

/** Resolve titles at each enrollment's immutable version, including retired courses. */
export async function listEnrolledCourses(actor: Actor, locale: Locale, database: LearnerDatabase = supabaseService() as unknown as LearnerDatabase) {
  const result = await database.from('enrollments').select('course_id,course_version_id,status,branch_id,branch_scope_known').eq('user_id', actor.userId).in('status', ['active', 'completed']).order('enrolled_at', { ascending: false });
  databaseFailure(result.error, 'Course enrollments could not be loaded');
  const rows = recordsOf(result.data).filter(row => typeof row.course_id === 'string' && typeof row.course_version_id === 'string' && (row.status === 'active' || row.status === 'completed'));
  const accessible = (await Promise.all(rows.map(async row => {
    try { await assertEnrollmentMembershipAccess(actor, row, database); return row; }
    catch (error) { if (error instanceof ApiError && error.code === 'MEMBERSHIP_SUSPENDED') return null; throw error; }
  }))).filter((row): row is Record<string, unknown> => row !== null);
  if (!accessible.length) return { courses: [] };
  const outlines = await database.from('course_version_outline').select('version_id,course_id,meta,default_language').in('version_id', [...new Set(accessible.map(row => row.course_version_id))]);
  databaseFailure(outlines.error, 'Course titles could not be loaded');
  const byVersion = new Map(recordsOf(outlines.data).map(row => [row.version_id, row]));
  return { courses: accessible.flatMap(row => {
    const outline = byVersion.get(row.course_version_id);
    if (!outline || outline.course_id !== row.course_id) return [];
    const title = recordOf(outline.meta)?.title;
    const localized = typeof title === 'string' ? title : recordOf(title) ? resolveL10nString(title as L10nString, locale, outline.default_language === 'en' ? 'en' : 'vi') : '';
    return [{ id: row.course_id as string, title: localized || row.course_id as string }];
  }) };
}

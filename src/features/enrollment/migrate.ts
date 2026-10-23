import 'server-only';

import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import {
  databaseFailure,
  oneRecord,
  recordOf,
  recordsOf,
  type LearnerDatabase,
  type LearnerQuery,
} from '@/features/learning/shared';

const MIGRATION_BATCH_SIZE = 100;
const FALLBACK_SKIP_REASON = 'MIGRATION_FAILED';

export type EnrollmentMigrationResult = {
  migrated: string[];
  skipped: Array<{ userId: string; reason: string }>;
};

export type EnrollmentMigrationDisplayResult = {
  migrated: string[];
  skipped: Array<{ userId: string; handle: string | null; reason: string }>;
};

function enrollmentBatch(query: LearnerQuery, afterId: string | null) {
  const ordered = query.order('id', { ascending: true }).limit(MIGRATION_BATCH_SIZE);
  return afterId ? ordered.gt('id', afterId) : ordered;
}

export function createEnrollmentMigrationService({
  database,
}: { database: LearnerDatabase }) {
  return {
    async migrate(courseId: string): Promise<EnrollmentMigrationResult> {
      const courseResult = await database.from('courses')
        .select('id,current_version_id')
        .eq('id', courseId)
        .maybeSingle();
      databaseFailure(courseResult.error, 'Course could not be loaded');
      const course = recordOf(courseResult.data);
      if (!course || typeof course.current_version_id !== 'string') {
        throw new ApiError(409, 'COURSE_NOT_PUBLISHED', 'Course does not have a published version');
      }
      const latestVersionId = course.current_version_id;
      const migrated: string[] = [];
      const skipped: EnrollmentMigrationResult['skipped'] = [];
      let afterId: string | null = null;

      while (true) {
        const batchResult = await enrollmentBatch(
          database.from('enrollments')
            .select('id,user_id,course_version_id,status')
            .eq('course_id', courseId)
            .eq('status', 'active')
            .neq('course_version_id', latestVersionId),
          afterId,
        );
        databaseFailure(batchResult.error, 'Enrollments could not be loaded');
        const rows = recordsOf(batchResult.data);
        const enrollments = rows.filter((row) => (
          typeof row.id === 'string'
          && typeof row.user_id === 'string'
          && typeof row.course_version_id === 'string'
          && row.course_version_id !== latestVersionId
          && row.status === 'active'
        ));

        for (const enrollment of enrollments) {
          const userId = enrollment.user_id as string;
          try {
            const migrationResult = await database.rpc('learner_migrate_enrollment', {
              p_user_id: userId,
              p_course_id: courseId,
              p_from_version: enrollment.course_version_id as string,
              p_to_version: latestVersionId,
            });
            if (migrationResult.error) {
              skipped.push({ userId, reason: FALLBACK_SKIP_REASON });
              continue;
            }
            const outcome = oneRecord(migrationResult.data);
            if (outcome?.status === 'migrated') {
              migrated.push(userId);
              continue;
            }
            skipped.push({
              userId,
              reason: typeof outcome?.reason === 'string' && outcome.reason
                ? outcome.reason
                : FALLBACK_SKIP_REASON,
            });
          } catch {
            skipped.push({ userId, reason: FALLBACK_SKIP_REASON });
          }
        }

        if (rows.length < MIGRATION_BATCH_SIZE) break;
        const lastId = rows.at(-1)?.id;
        if (typeof lastId !== 'string' || lastId === afterId) break;
        afterId = lastId;
      }

      return { migrated, skipped };
    },
  };
}

export async function migrateEnrollments(courseId: string): Promise<EnrollmentMigrationDisplayResult> {
  const database = supabaseService() as unknown as LearnerDatabase;
  const result = await createEnrollmentMigrationService({ database }).migrate(courseId);
  const handles = new Map<string, string>();
  for (let offset = 0; offset < result.skipped.length; offset += MIGRATION_BATCH_SIZE) {
    const userIds = result.skipped
      .slice(offset, offset + MIGRATION_BATCH_SIZE)
      .map(({ userId }) => userId);
    const profilesResult = await database.from('profiles')
      .select('id,handle')
      .in('id', userIds);
    if (profilesResult.error) continue;
    for (const profile of recordsOf(profilesResult.data)) {
      if (typeof profile.id === 'string' && typeof profile.handle === 'string') {
        handles.set(profile.id, profile.handle);
      }
    }
  }
  return {
    migrated: result.migrated,
    skipped: result.skipped.map((entry) => ({
      ...entry,
      handle: handles.get(entry.userId) ?? null,
    })),
  };
}

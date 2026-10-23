import 'server-only';

import { issue } from '@/features/certificates/service';
import { award } from '@/features/xp/service';
import { supabaseService } from '@/lib/supabase/server';

export type CourseCompletionTransition = {
  user_id: string;
  course_id: string;
  course_version_id: string;
  completed_at: string;
};

type QueryResult = { data: unknown; error: unknown | null };
type CompletionQuery = {
  select(columns: string): CompletionQuery;
  eq(column: string, value: unknown): CompletionQuery;
  maybeSingle(): Promise<QueryResult>;
};

export type CompletionEffectDatabase = {
  from(table: string): CompletionQuery;
};

type Dependencies = {
  database: CompletionEffectDatabase;
  issueCertificate: typeof issue;
  awardXp: typeof award;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createCourseCompletionEffect({ database, issueCertificate, awardXp }: Dependencies) {
  return async (completion: CourseCompletionTransition): Promise<void> => {
    const outlineResult = await database.from('course_version_outline')
      .select('completion')
      .eq('version_id', completion.course_version_id)
      .eq('course_id', completion.course_id)
      .maybeSingle();
    if (outlineResult.error) throw new Error('Course completion settings could not be loaded');
    const settings = record(record(outlineResult.data)?.completion);
    if (!settings) throw new Error('Course completion settings could not be loaded');

    const effects: Promise<unknown>[] = [awardXp(
      completion.user_id,
      'course_completed',
      'course',
      completion.course_id,
    )];
    if (settings.certificate === true) {
      effects.push(issueCertificate(
        completion.user_id,
        completion.course_id,
        completion.course_version_id,
      ));
    }
    const results = await Promise.allSettled(effects);
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'Course completion effects failed');
  };
}

export async function handleCourseCompleted(completion: CourseCompletionTransition) {
  return createCourseCompletionEffect({
    database: supabaseService() as unknown as CompletionEffectDatabase,
    issueCertificate: issue,
    awardXp: award,
  })(completion);
}

export type LessonCompletionEffect = {
  userId: string;
  courseVersionId: string;
  itemId: string;
};

export async function handleLessonCompleted(effect: LessonCompletionEffect) {
  await award(
    effect.userId,
    'lesson_completed',
    'lesson',
    `${effect.courseVersionId}:${effect.itemId}`,
  );
}

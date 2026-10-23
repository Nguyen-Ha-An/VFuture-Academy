import { getLocale } from 'next-intl/server';

import { EnrollmentMigrationPanel, type MigrationCourse } from '@/features/enrollment/EnrollmentMigrationPanel';
import { listCourses } from '@/features/studio/drafts';
import { getActor, hasPermission } from '@/lib/permissions';
import { loginDestination } from '@/lib/auth';
import { forbidden, redirect } from 'next/navigation';
import { supabaseService } from '@/lib/supabase/server';

function courseTitle(value: unknown, locale: string, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const title = (value as Record<string, unknown>).title;
  if (typeof title === 'string') return title;
  if (!title || typeof title !== 'object' || Array.isArray(title)) return fallback;
  const titles = title as Record<string, unknown>;
  return typeof titles[locale] === 'string' ? titles[locale] : typeof titles.vi === 'string' ? titles.vi : typeof titles.en === 'string' ? titles.en : fallback;
}

export default async function EnrollmentMigrationPage() {
  const actor = await getActor();
  if (!actor) redirect(await loginDestination());
  if (!hasPermission(actor, 'course.publish')) forbidden();
  const locale = await getLocale();
  const courseRows = await listCourses();
  const courseIds = courseRows.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? [id] : [];
  });
  const draftResult = courseIds.length === 0 ? { data: [], error: null } : await supabaseService()
    .from('course_drafts')
    .select('course_id,manifest')
    .in('course_id', courseIds);
  if (draftResult.error) throw new Error('Course metadata could not be loaded');
  const draftRows = draftResult.data;
  const manifests = new Map((Array.isArray(draftRows) ? draftRows : []).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    return typeof row.course_id === 'string' ? [[row.course_id, row.manifest] as const] : [];
  }));
  const courses = courseRows.flatMap((value): MigrationCourse[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    return typeof row.id === 'string' ? [{ id: row.id, title: courseTitle(manifests.get(row.id), locale, row.id) }] : [];
  });
  return <EnrollmentMigrationPanel courses={courses} />;
}

import { assertContentAccess } from '@/features/admin/content-review';
import type { Actor } from '@/lib/permissions';
import type { ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';

/** Collapse denial, absence, and database errors so course ids cannot be probed. */
export async function assertMcpCourseAccess(
  db: ReadOnlyDatabase,
  actor: Actor,
  courseId: string,
  permission: 'content.read' | 'content.edit',
): Promise<void> {
  try {
    await assertContentAccess(db, actor, 'course', courseId, permission);
  } catch {
    throw new StudioMcpError('COURSE_NOT_FOUND_OR_FORBIDDEN');
  }
}

export async function canMcpEditCourse(db: ReadOnlyDatabase, actor: Actor, courseId: string): Promise<boolean> {
  try {
    await assertMcpCourseAccess(db, actor, courseId, 'content.edit');
    return true;
  } catch {
    return false;
  }
}

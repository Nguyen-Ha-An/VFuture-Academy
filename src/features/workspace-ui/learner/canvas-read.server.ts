import 'server-only';
import type { Actor } from '@/lib/permissions';
import type { Locale } from '@/content-engine';
import { listCourseTasks, listCourseResults, listLearningAnnouncements } from '@/features/coursework/service';
import type { CanvasAnnouncement, CanvasResult, CanvasTask } from './canvas-model';

/** Full authorized set: client filters and factual counts must not operate on a capped preview. */
export async function dashboardTasks(actor: Actor, locale: Locale): Promise<CanvasTask[] | null> {
  try {
    return await listCourseTasks(actor, { locale });
  } catch (error) {
    console.error('[learner dashboard] tasks unavailable', error);
    return null;
  }
}

/** The service releases recorded scores; this adapter never calculates a course grade. */
export async function dashboardResults(actor: Actor, locale: Locale): Promise<CanvasResult[] | null> {
  try {
    const results = await listCourseResults(actor, { locale });
    return results.map(result => ({ id: result.id, courseId: result.courseId, title: result.title, courseTitle: result.courseTitle,
      href: result.href, score: result.points, maxScore: result.maxPoints, status: result.status, recordedAt: result.recordedAt }));
  } catch (error) {
    console.error('[learner dashboard] results unavailable', error);
    return null;
  }
}

export async function dashboardAnnouncements(actor: Actor, locale: Locale): Promise<CanvasAnnouncement[] | null> {
  try {
    return await listLearningAnnouncements(actor, { locale });
  } catch (error) {
    console.error('[learner dashboard] announcements unavailable', error);
    return null;
  }
}

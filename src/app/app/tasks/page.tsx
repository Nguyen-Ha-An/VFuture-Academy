import { getLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { listCourseTasks } from '@/features/coursework/service';
import { CanvasTasks } from '@/features/workspace-ui/learner/CanvasLearningLists';
import { canvasCopy } from '@/features/workspace-ui/learner/canvas-copy';

/** Complete authorized task list, including unscheduled work and submitted/reviewed attempts. */
export default async function LearnerTasksPage() {
  const [user, localeValue] = await Promise.all([requireUser(), getLocale()]);
  const locale = localeValue === 'en' ? 'en' : 'vi';
  const copy = canvasCopy(locale);
  const tasks = await listCourseTasks({ userId: user.id, roles: [] }, { locale }).catch(error => {
    console.error('[learner tasks] unavailable', error);
    return null;
  });
  return <div className="canvas-page canvas-learning"><header className="canvas-page-heading"><div><h1>{copy.tasksTitle}</h1><p className="canvas-muted">{copy.tasksDescription}</p></div></header>
    <section className="canvas-panel canvas-assignment-group" aria-label={copy.tasksTitle}><CanvasTasks tasks={tasks} locale={locale} allTasks /></section>
  </div>;
}

import { getLocale } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { listCourseResults } from '@/features/coursework/service';
import { CanvasResults } from '@/features/workspace-ui/learner/CanvasLearningLists';
import { canvasCopy } from '@/features/workspace-ui/learner/canvas-copy';

export default async function LearnerResultsPage() {
  const [user, localeValue] = await Promise.all([requireUser(), getLocale()]);
  const locale = localeValue === 'en' ? 'en' : 'vi';
  const results = await listCourseResults({ userId: user.id, roles: [] }, { locale }).catch(error => { console.error('[learner results] unavailable', error); return null; });
  return <div className="canvas-page canvas-learning"><header className="canvas-page-heading"><h1 tabIndex={-1}>{canvasCopy(locale).results}</h1></header><CanvasResults results={results?.map(result => ({ ...result, score: result.points, maxScore: result.maxPoints })) ?? null} locale={locale} /></div>;
}

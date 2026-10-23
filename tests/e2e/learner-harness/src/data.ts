// Deterministic presentation data only. No database, auth credentials, or runtime writes.
import { locale } from './i18n';

// C12 geometry: a long title must wrap at full width on a 375px phone.
const LONG_TITLE = 'Understanding responsible technology decisions in communities, schools and small organisations';

const entry = (id: string, status: 'active' | 'completed' | null) => ({
  id, title: `${id} course`, summary: 'A course for practicing responsible technology.',
  level: 'foundation', difficulty: 'beginner', pathway: 'ai-emerging-technology', languages: ['en', 'vi'],
  estimatedMinutes: 45, skills: [], versionId: 'version', enrollment: status ? { status, courseVersionId: 'version' } : null,
});
export async function requireUser() { return { id: 'fixture', email: 'fixture@example.invalid' }; }
export async function listCatalog() { return [entry('active', 'active'), entry('completed', 'completed'), entry('available', null)]; }
export async function readLearnerHome() {
  return { continueLearning: null, nextRequired: null, upcomingExam: null, feedback: null, rewards: { profile: { displayName: 'Student', handle: null }, xpTotal: 0, streak: { current: 0 }, certificates: [] } };
}
export async function getCourse(_actor: unknown, id: string) {
  const complete = id === 'completed';
  const course = entry(id, complete ? 'completed' : 'active');
  return { id, meta: { ...course, learningOutcomes: [] }, enrollment: course.enrollment,
    outline: { modules: [{ id: 'module', title: 'Module one', items: [
      { id: 'first', title: 'First lesson', type: 'lesson', required: true, status: 'completed' },
      { id: 'optional', title: 'Optional practice', type: 'lesson', required: false, status: 'not_started' },
      { id: 'long', title: LONG_TITLE, type: 'lesson', required: true, status: 'not_started' },
      { id: 'exam', title: 'Module exam', type: 'exam', required: true, status: 'not_started' },
    ] }] }, progress: { completedItems: 1, totalItems: 4, items: { first: 'completed', optional: 'not_started', long: 'not_started', exam: 'not_started' } },
    skills: [], completion: { requirements: [] } };
}
export async function getItemPayload(_actor: unknown, _course: string, id: string) {
  if (id === 'exam') return { item: { kind: 'exam', id, title: 'Module exam', settings: {}, sections: [] }, locale: locale(), courseVersionId: 'version', activityState: {} };
  const title = id === 'first' ? 'First lesson' : id === 'long' ? LONG_TITLE : 'Optional practice';
  return { item: { kind: 'lesson', id, title, completion: { mode: 'view' } }, locale: locale(), courseVersionId: 'version', activityState: {} };
}
export async function readItemActivitySummary() { return { completionMode: 'view', attemptsUsed: 0 }; }
export async function session() { throw new Error('Assignment sessions are outside this presentation fixture.'); }

// Bench dashboard readouts: an empty passport and board keep the fixture presentation-only.
export const SKILL_LEVELS = ['exposed', 'applied', 'demonstrated'] as const;
export async function passport() { return []; }
export async function branchIdForUser() { return null; }
export async function weeklyLeaderboard() { return []; }
export async function learnerActivitySeries() { return { days: [], events: [], values: [], week: { current: 0, previous: 0 } }; }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

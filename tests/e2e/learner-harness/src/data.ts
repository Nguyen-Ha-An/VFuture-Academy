// Deterministic presentation data only. No database, auth credentials, or runtime writes.
import { locale } from './i18n';
import { fixtureScenario, fixtureLearnerName, fixtureCourseIds, fixtureCourseTitle, fixtureTaskRecords, fixtureTasks, fixtureResults, fixtureAnnouncements } from './scenarios';
import type { CatalogFilters } from '@/features/catalog/service';
import type { AssignmentLocator } from '@/content-engine/render/assignment-contracts';
import { ASSIGNMENT_COURSE, ASSIGNMENT_VERSION, assignmentSession, publishedAssignment, publishedLesson, publishedExam } from './activity-fixtures';

// C12 geometry: a long title must wrap at full width on a 375px phone.
const LONG_TITLE = 'Understanding responsible technology decisions in communities, schools and small organisations';

const entry = (id: string, status: 'active' | 'completed' | null) => ({
  id, title: `${id} course`, summary: 'A course for practicing responsible technology.',
  level: 'foundation', difficulty: 'beginner', pathway: 'ai-emerging-technology', languages: ['en', 'vi'],
  estimatedMinutes: 45, skills: [], versionId: `${id}-published-v1`, enrollment: status ? { status, courseVersionId: `${id}-published-v1` } : null,
});
export async function requireUser() { return { id: 'fixture', email: 'fixture@example.invalid' }; }
export async function listCatalog(_actor?: unknown, _locale?: unknown, filters: CatalogFilters = {}) {
  const scenario = fixtureScenario();
  if (scenario === 'empty') return [];
  const rows = [...fixtureCourseIds(scenario).map(id => ({ ...entry(id, 'active'), title: fixtureCourseTitle(id, scenario) })), entry('completed', 'completed'), entry('available', null)];
  return rows.filter(row => (!filters.level || row.level === filters.level) && (!filters.pathway || row.pathway === filters.pathway) && (!filters.difficulty || row.difficulty === filters.difficulty) && (!filters.language || row.languages.includes(filters.language)));
}
export async function readLearnerHome() {
  return { continueLearning: null, nextRequired: null, upcomingExam: null, feedback: null, rewards: { profile: { displayName: fixtureLearnerName(), handle: null }, xpTotal: 0, streak: { current: 0 }, certificates: [] } };
}
export async function getCourse(_actor: unknown, id: string) {
  if (id === ASSIGNMENT_COURSE) {
    const assignment = publishedAssignment(locale());
    const rows = [{ id: 'first', title: locale() === 'en' ? 'Research introduction' : 'Giới thiệu nghiên cứu', type: 'lesson', required: true, status: 'completed' },
      { id: 'assignment', title: assignment.title, type: 'assignment', required: true, status: 'in_progress' },
      { id: 'inline', title: locale() === 'en' ? 'Embedded research activity' : 'Hoạt động nghiên cứu trong bài học', type: 'lesson', required: true, status: 'in_progress' }];
    return { id, meta: { ...entry(id, 'active'), title: locale() === 'en' ? 'Community research' : 'Nghiên cứu cộng đồng', learningOutcomes: [] },
      enrollment: { status: 'active', courseVersionId: ASSIGNMENT_VERSION }, outline: { modules: [{ id: 'research-module', title: locale() === 'en' ? 'Evidence and recommendations' : 'Bằng chứng và đề xuất', items: rows }] },
      progress: { completedItems: 1, totalItems: 3, items: Object.fromEntries(rows.map(row => [row.id, row.status])) }, skills: [], completion: { requirements: [] } };
  }
  const complete = id === 'completed';
  const course = { ...entry(id, id === 'available' ? null : complete ? 'completed' : 'active'), title: fixtureCourseTitle(id, fixtureScenario()) };
  const tasks = fixtureTaskRecords(fixtureScenario()).filter(task => task.courseId === id);
  const rows = [
    { id: 'first', title: 'First lesson', type: 'lesson', required: true, status: 'completed' },
    { id: 'optional', title: 'Optional practice', type: 'lesson', required: false, status: 'not_started' },
    { id: 'long', title: LONG_TITLE, type: 'lesson', required: true, status: complete ? 'completed' : 'not_started' },
    ...tasks.map(task => ({ id: task.itemId, title: task.title, type: task.kind, required: true, status: task.status === 'approved' ? 'completed' : task.status === 'not_started' ? 'not_started' : 'in_progress' })),
  ];
  return { id, meta: { ...course, learningOutcomes: [] }, enrollment: course.enrollment,
    outline: { modules: [{ id: 'module', title: 'Module one', items: rows }] },
    progress: { completedItems: rows.filter(row => row.status === 'completed').length, totalItems: rows.length, items: Object.fromEntries(rows.map(row => [row.id, row.status])) },
    skills: [], completion: { requirements: [] } };
}

export async function getItemPayload(_actor: unknown, course: string, id: string) {
  if (course === ASSIGNMENT_COURSE && id === 'assignment') return { item: publishedAssignment(locale()), locale: locale(), courseVersionId: ASSIGNMENT_VERSION, activityState: {} };
  if (course === ASSIGNMENT_COURSE && id === 'inline') {
    const { kind: _kind, ...body } = publishedAssignment(locale(), 'embedded-work');
    return { item: { ...publishedLesson(locale(), id, locale() === 'en' ? 'Embedded research activity' : 'Hoạt động nghiên cứu trong bài học'), blocks: [{ type: 'paragraph', content: [{ text: locale() === 'en' ? 'Use the research activity below to submit your evidence.' : 'Sử dụng hoạt động nghiên cứu bên dưới để nộp bằng chứng.' }] }, { ...body, type: 'assignment' }] }, locale: locale(), courseVersionId: ASSIGNMENT_VERSION, activityState: {} };
  }
  const task = fixtureTaskRecords(fixtureScenario()).find(row => row.courseId === course && row.itemId === id);
  if (task?.kind === 'assignment') return { item: { ...publishedAssignment(locale(), id), title: task.title }, locale: locale(), courseVersionId: task.courseVersionId, activityState: {} };
  if (task?.kind === 'exam') return { item: { ...publishedExam(locale()), id, title: task.title }, locale: locale(), courseVersionId: task.courseVersionId, activityState: {} };
  const title = id === 'first' ? 'First lesson' : id === 'long' ? LONG_TITLE : 'Optional practice';
  return { item: publishedLesson(locale(), id, title), locale: locale(), courseVersionId: course === ASSIGNMENT_COURSE ? ASSIGNMENT_VERSION : `${course}-published-v1`, activityState: {} };
}
export async function readItemActivitySummary(_actor?: unknown, version?: string, itemId?: string) {
  if (version === ASSIGNMENT_VERSION && itemId) {
    const current = assignmentSession({ courseId: ASSIGNMENT_COURSE, itemId, blockId: itemId === 'inline' ? 'embedded-work' : null }, locale(), new URLSearchParams(location.search).get('assignmentState') ?? 'draft');
    return { completionMode: 'activities', attemptsUsed: current.attemptsUsed };
  }
  const task = fixtureTaskRecords(fixtureScenario()).find(row => row.itemId === itemId && row.courseVersionId === version);
  if (task) return { completionMode: task.kind === 'assignment' ? 'activities' : null, attemptsUsed: task.submissionId ? 1 : 0 };
  return { completionMode: 'view', attemptsUsed: 0 };
}
export async function session(_actor: unknown, locator: AssignmentLocator) {
  const task = fixtureTaskRecords(fixtureScenario()).find(row => row.courseId === locator.courseId && row.itemId === locator.itemId && row.blockId === locator.blockId);
  const state = new URLSearchParams(location.search).get('assignmentState')
    ?? (task?.late === true ? 'late' : task?.status === 'changes_requested' ? 'feedback' : task?.status === 'approved' ? 'approved' : task?.status === 'in_review' ? 'in_review' : task?.status === 'submitted' ? 'submitted' : 'draft');
  return assignmentSession(locator, locale(), state, task?.courseVersionId ?? (locator.courseId === ASSIGNMENT_COURSE ? ASSIGNMENT_VERSION : `${locator.courseId}-published-v1`));
}

// Bench dashboard readouts: an empty passport and board keep the fixture presentation-only.
export const SKILL_LEVELS = ['exposed', 'applied', 'demonstrated'] as const;
export async function passport() { return []; }
export async function branchIdForUser() { return null; }
export async function weeklyLeaderboard() { return []; }
export async function learnerActivitySeries() { return { days: [], events: [], values: [], week: { current: 0, previous: 0 } }; }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

// The real read-model contracts; scenarios are disposable records, never a database connection.
export async function listCourseTasks(_actor?: unknown, query: { courseId?: string } = {}) { return fixtureTasks(fixtureScenario()).filter(row => !query.courseId || row.courseId === query.courseId); }
export async function listCourseResults(_actor?: unknown, query: { courseId?: string } = {}) { return fixtureResults(fixtureScenario()).filter(row => !query.courseId || row.courseId === query.courseId); }
export async function listLearningAnnouncements(_actor?: unknown, query: { courseId?: string } = {}) { return fixtureAnnouncements(fixtureScenario()).filter(row => !query.courseId || row.courseId === query.courseId); }
export async function listLearningCalendar(_actor: unknown, query: { start: string; end: string; courseId?: string }) {
  const events = fixtureTasks(fixtureScenario()).filter(row => row.dueAt && (!query.courseId || row.courseId === query.courseId))
    .map(row => ({ ...row, id: `event-${row.id}`, kind: 'assignment_due', at: row.dueAt! })).filter(event => event.at >= query.start && event.at < query.end);
  return { timeZone: 'Asia/Ho_Chi_Minh', events };
}

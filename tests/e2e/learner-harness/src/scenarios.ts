import type { CourseTask, CourseResult, LearningAnnouncement } from '@/features/coursework/contracts';
import { learnerReviewParam } from './review-state';
export const FIXTURE_SCENARIOS = ['baseline', 'sparse', 'dense', 'empty', 'mixed-error', 'tasks-error'] as const;
export type FixtureScenario = typeof FIXTURE_SCENARIOS[number];
export function fixtureLearnerName(): string {
  return learnerReviewParam('longName') === '1'
    ? 'A very long learner name used to verify account menu geometry and truncation behavior'
    : 'Avery Nguyen';
}
export function fixtureScenario(): FixtureScenario {
  const value = learnerReviewParam('fixture');
  return FIXTURE_SCENARIOS.includes(value as FixtureScenario) ? value as FixtureScenario : 'baseline';
}
const dense = (scenario: FixtureScenario) => ['dense', 'mixed-error', 'tasks-error'].includes(scenario);
const courses = [{ id: 'active', title: 'Responsible technology' }, { id: 'data', title: 'Data for everyday decisions' }, { id: 'design', title: 'Designing community projects' }, { id: 'systems', title: 'Understanding living systems' }];
export function fixtureCourseIds(scenario: FixtureScenario) { return scenario === 'empty' ? [] : dense(scenario) ? courses.map(course => course.id) : ['active']; }
export function fixtureCourseTitle(id: string, scenario: FixtureScenario) { return dense(scenario) ? courses.find(course => course.id === id)?.title ?? `${id} course` : `${id} course`; }
const identity = { courseId: 'active', courseVersionId: 'active-published-v1', branchId: 'fixture-school', itemId: '', blockId: null, title: 'Community research assignment', courseTitle: 'active course', href: '' };
/** Published task definitions are separate from simulated read failures. */
export function fixtureTaskRecords(scenario: FixtureScenario): CourseTask[] {
  if (scenario === 'empty' || scenario === 'sparse') return [];
  if (!dense(scenario)) return [
    { ...identity, id: 'task-1', itemId: 'research-assignment', href: '/app/courses/active/items/research-assignment', kind: 'assignment', status: 'not_started', dueAt: '2026-11-12T09:00:00Z', submissionId: null, late: null },
    { ...identity, id: 'task-unscheduled', itemId: 'research-journal', href: '/app/courses/active/items/research-journal', title: 'Unscheduled research journal', kind: 'assignment', status: 'not_started', dueAt: null, submissionId: null, late: null },
    { ...identity, id: 'task-late', itemId: 'reflection-assignment', href: '/app/courses/active/items/reflection-assignment', title: 'Submitted reflection', kind: 'assignment', status: 'submitted', dueAt: '2026-11-02T09:00:00Z', submissionId: 'submission-late', late: true },
    { ...identity, id: 'task-exam', itemId: 'exam', href: '/app/courses/active/items/exam', title: 'Module exam', kind: 'exam', status: 'in_progress', dueAt: null, submissionId: 'exam-active', late: null },
  ];
  const statuses = ['not_started', 'in_progress', 'submitted', 'in_review', 'approved', 'changes_requested'];
  const titles = ['Interview evidence', 'Clean the survey dataset', 'Community reflection', 'Compare two design proposals', 'Explain the observed system', 'Revise the recommendation', 'Evaluate the sources', 'Build a small data summary', 'Research journal', 'Test a design assumption', 'Module assessment', 'Final evidence review'];
  return titles.map((title, index) => {
    const course = courses[index % courses.length];
    const kind = [1, 7, 8, 10].includes(index) ? 'exam' as const : 'assignment' as const;
    const status = index === 10 ? 'graded' : statuses[index % statuses.length];
    const itemId = kind === 'exam' ? 'exam' : `assignment-${index + 1}`;
    return { ...identity, id: `dense-task-${index}`, courseId: course.id, courseVersionId: `${course.id}-published-v1`, courseTitle: course.title, itemId, title,
      href: `/app/courses/${course.id}/items/${itemId}`, kind, status,
      dueAt: index === 6 || kind === 'exam' ? null : index === 0 || index === 2 ? '2026-11-01T09:00:00Z' : '2026-11-12T09:00:00Z',
      submissionId: ['submitted', 'in_review', 'approved', 'changes_requested', 'graded'].includes(status) ? `dense-submission-${index}` : null,
      late: index === 2 ? true : null };
  });
}
export function fixtureTasks(scenario: FixtureScenario): CourseTask[] {
  if (scenario === 'tasks-error') throw new Error('Disposable fixture: tasks unavailable');
  return fixtureTaskRecords(scenario);
}
export function fixtureResults(scenario: FixtureScenario): CourseResult[] {
  if (scenario === 'mixed-error') throw new Error('Disposable fixture: results unavailable');
  if (scenario === 'empty' || scenario === 'sparse') return [];
  const rows: CourseResult[] = [{ ...identity, id: 'result-1', title: 'Recorded module exam', itemId: 'exam', href: '/app/courses/active/items/exam', kind: 'exam', status: 'graded', points: 7.5, maxPoints: 10, percent: 75, passed: true, recordedAt: '2026-11-03T01:00:00Z' }];
  return !dense(scenario) ? rows : Array.from({ length: 6 }, (_, index) => ({ ...rows[0], id: `dense-result-${index}`, courseId: courses[index % courses.length].id, courseVersionId: `${courses[index % courses.length].id}-published-v1`, courseTitle: courses[index % courses.length].title,
    title: ['Evidence review', 'Module assessment', 'Design reflection'][index % 3], points: [7.5, 4, 0, 8, 3, 9][index], maxPoints: index === 1 || index === 4 ? 5 : 10,
    href: `/app/courses/${courses[index % courses.length].id}/items/exam` }));
}
export function fixtureAnnouncements(scenario: FixtureScenario): LearningAnnouncement[] {
  if (scenario === 'mixed-error') throw new Error('Disposable fixture: announcements unavailable');
  if (scenario === 'empty' || scenario === 'sparse') return [];
  const row = { id: 'announcement-1', branchId: 'fixture-school', courseId: 'active', courseTitle: 'active course', title: 'Welcome to the course', body: 'Read the module guide before your first assignment.\nYour school team is here to help.', publishedAt: '2026-11-01T01:00:00Z' };
  return !dense(scenario) ? [row] : Array.from({ length: 5 }, (_, index) => ({ ...row, id: `dense-announcement-${index}`, courseId: courses[index % courses.length].id, courseTitle: courses[index % courses.length].title,
    title: ['Prepare for the next module', 'Research guidance is available', 'Review your submission feedback', 'Planning the project workshop', 'This week’s learning activities'][index],
    body: 'Review the published module instructions and the next activity before preparing your work. Course updates remain available in Announcements.', publishedAt: `2026-11-0${index + 1}T01:00:00Z` }));
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureTasks, fixtureResults, fixtureAnnouncements, fixtureLearnerName } from '../../e2e/learner-harness/src/scenarios';
import { listCatalog, listCourseTasks, listCourseResults, listLearningAnnouncements, getCourse, getItemPayload, session, readItemActivitySummary } from '../../e2e/learner-harness/src/data';
afterEach(() => { window.history.replaceState({}, '', '/'); sessionStorage.clear(); });

describe('disposable learner scenario data', () => {
  it('provides dense status/deadline/course variation with recorded zero scores intact', () => {
    const tasks = fixtureTasks('dense');
    expect(tasks).toHaveLength(12);
    expect(new Set(tasks.map(task => task.courseId)).size).toBe(4);
    expect(new Set(tasks.map(task => task.status))).toEqual(new Set(['not_started', 'in_progress', 'submitted', 'in_review', 'approved', 'changes_requested', 'graded']));
    expect(tasks.some(task => task.dueAt === null)).toBe(true);
    expect(tasks.some(task => task.late === true && task.submissionId)).toBe(true);
    expect(fixtureResults('dense').some(result => result.points === 0)).toBe(true);
    expect(fixtureAnnouncements('dense')).toHaveLength(5);
  });
  it('respects course filters in every fixture read instead of showing another course’s records', async () => {
    window.history.replaceState({}, '', '/app?fixture=dense');
    for (const read of [listCourseTasks, listCourseResults, listLearningAnnouncements]) {
      const rows = await read({}, { courseId: 'data' });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(row => row.courseId === 'data')).toBe(true);
      expect(await read({}, { courseId: 'unknown' })).toEqual([]);
    }
    expect((await listCatalog({}, 'en', { difficulty: 'advanced' }))).toEqual([]);
  });
  it('distinguishes empty enrollment, sparse enrolled data, and independent read failures', async () => {
    window.history.replaceState({}, '', '/app?fixture=empty');
    expect(await listCatalog()).toEqual([]);
    window.history.replaceState({}, '', '/app?fixture=sparse');
    expect((await listCatalog()).some(course => course.enrollment?.status === 'active')).toBe(true);
    expect(await listCourseTasks()).toEqual([]);
    expect(await listCourseResults()).toEqual([]);
    expect(await listLearningAnnouncements()).toEqual([]);
    window.history.replaceState({}, '', '/app?fixture=mixed-error');
    expect(await listCourseTasks()).toHaveLength(12);
    await expect(listCourseResults()).rejects.toThrow('results unavailable');
    await expect(listLearningAnnouncements()).rejects.toThrow('announcements unavailable');
    window.history.replaceState({}, '', '/app?fixture=tasks-error');
    await expect(listCourseTasks()).rejects.toThrow('tasks unavailable');
    expect(await listCourseResults()).toHaveLength(6);
    expect(await listLearningAnnouncements()).toHaveLength(5);
  });
  it.each(['assignment', 'inline'])('routes actual %s content with a pinned session and existing outline identity', async itemId => {
    window.history.replaceState({}, '', `/app/courses/assignment-course/items/${itemId}?assignmentState=feedback&lang=en`);
    const course = await getCourse({}, 'assignment-course');
    const payload = await getItemPayload({}, 'assignment-course', itemId);
    const current = await session({}, { courseId: course.id, itemId, blockId: itemId === 'inline' ? 'embedded-work' : null });
    expect(course.outline.modules.flatMap(module => module.items).some(item => item.id === itemId)).toBe(true);
    expect(payload.courseVersionId).toBe(current.courseVersionId);
    expect(course.enrollment?.courseVersionId).toBe(current.courseVersionId);
    expect(current.submissions[0].grade?.released).toBe(true);
    expect(await readItemActivitySummary({}, payload.courseVersionId, itemId)).toEqual({ completionMode: 'activities', attemptsUsed: 1 });
    expect(payload.item.kind).toBe(itemId === 'inline' ? 'lesson' : 'assignment');
  });
  it.each(['baseline', 'dense'])('gives every %s task a unique real item, matching outline, payload and pinned version', async scenario => {
    window.history.replaceState({}, '', `/app?fixture=${scenario}`);
    const tasks = await listCourseTasks();
    expect(new Set(tasks.map(task => JSON.stringify([task.courseId, task.courseVersionId, task.itemId, task.blockId]))).size).toBe(tasks.length);
    for (const task of tasks) {
      const course = await getCourse({}, task.courseId);
      const outline = course.outline.modules.flatMap(module => module.items).find(item => item.id === task.itemId);
      const payload = await getItemPayload({}, task.courseId, task.itemId);
      expect(outline?.type).toBe(task.kind);
      expect(payload.item.kind).toBe(task.kind);
      expect(payload.item.id).toBe(task.itemId);
      expect(payload.item.title).toBe(task.title);
      expect(payload.courseVersionId).toBe(task.courseVersionId);
      expect(course.enrollment?.courseVersionId).toBe(task.courseVersionId);
      expect(task.href).toBe(`/app/courses/${task.courseId}/items/${task.itemId}`);
      if (task.kind === 'assignment') {
        const current = await session({}, { courseId: task.courseId, itemId: task.itemId, blockId: task.blockId });
        expect(current.courseVersionId).toBe(task.courseVersionId);
      }
    }
  });
  it('keeps dense task destinations valid after a native link omits review flags, and resets explicitly', async () => {
    window.history.replaceState({}, '', '/app/tasks?fixture=dense&longName=1');
    const task = (await listCourseTasks()).find(task => task.kind === 'assignment')!;
    expect(fixtureLearnerName()).toContain('A very long');
    window.history.replaceState({}, '', task.href);
    const payload = await getItemPayload({}, task.courseId, task.itemId);
    expect(payload.item.kind).toBe('assignment');
    expect(payload.item.title).toBe(task.title);
    expect(await listCourseTasks()).toHaveLength(12);
    window.history.replaceState({}, '', '/app?fixture=baseline');
    expect(await listCourseTasks()).toHaveLength(4);
    expect(fixtureLearnerName()).toBe('Avery Nguyen');
  });
});

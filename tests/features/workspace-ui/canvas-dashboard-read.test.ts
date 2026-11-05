import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const reads = vi.hoisted(() => ({ tasks: vi.fn(), results: vi.fn(), announcements: vi.fn() }));
vi.mock('@/features/coursework/service', () => ({ listCourseTasks: reads.tasks, listCourseResults: reads.results, listLearningAnnouncements: reads.announcements }));
import { dashboardTasks, dashboardResults, dashboardAnnouncements } from '@/features/workspace-ui/learner/canvas-read.server';
const actor = { userId: 'learner', roles: [] };
afterEach(() => vi.clearAllMocks());

describe('dashboard authorized read models', () => {
  it('preserves the full task set, statuses, course identity and unknown deadlines for honest filtering/counts', async () => {
    const tasks = ['not_started', 'graded', 'approved', 'in_review', 'changes_requested', 'in_progress', 'submitted'].map((status, index) => ({ id: String(index), courseId: `course-${index % 2}`, status, dueAt: index ? '2026-11-01T00:00:00Z' : null }));
    reads.tasks.mockResolvedValue(tasks);
    expect(await dashboardTasks(actor, 'en')).toEqual(tasks);
    expect(reads.tasks).toHaveBeenCalledWith(actor, { locale: 'en' });
  });
  it('maps recorded released scores without aggregating or manufacturing a course total', async () => {
    reads.results.mockResolvedValue([{ id: 'recorded', courseId: 'course-1', title: 'Exam', courseTitle: 'Course', href: '/app/courses/course-1/items/exam', points: 7.5, maxPoints: 10, status: 'graded', recordedAt: '2026-11-03T00:00:00Z', percent: 75 }]);
    const results = await dashboardResults(actor, 'vi');
    expect(results).toEqual([{ id: 'recorded', courseId: 'course-1', title: 'Exam', courseTitle: 'Course', href: '/app/courses/course-1/items/exam', score: 7.5, maxScore: 10, status: 'graded', recordedAt: '2026-11-03T00:00:00Z' }]);
    expect(reads.results).toHaveBeenCalledWith(actor, { locale: 'vi' });
  });
  it('passes actual school-scoped announcements through with their authorized course identity', async () => {
    const announcements = [{ id: 'a', courseId: 'c', courseTitle: 'Course', branchId: 'school', title: 'Actual update', body: 'Published text', publishedAt: '2026-11-01T00:00:00Z' }];
    reads.announcements.mockResolvedValue(announcements);
    expect(await dashboardAnnouncements(actor, 'en')).toEqual(announcements);
    expect(reads.announcements).toHaveBeenCalledWith(actor, { locale: 'en' });
  });
  it('keeps read failures independent and distinguishes failure from a factual empty set', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.tasks.mockResolvedValue([]);
    reads.results.mockRejectedValue(new Error('offline'));
    reads.announcements.mockResolvedValue([]);
    expect(await Promise.all([dashboardTasks(actor, 'en'), dashboardResults(actor, 'en'), dashboardAnnouncements(actor, 'en')])).toEqual([[], null, []]);
    reads.tasks.mockRejectedValue(new Error('offline'));
    reads.announcements.mockRejectedValue(new Error('offline'));
    expect(await dashboardTasks(actor, 'vi')).toBeNull();
    expect(await dashboardAnnouncements(actor, 'vi')).toBeNull();
    log.mockRestore();
  });
});

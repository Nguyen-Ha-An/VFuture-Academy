import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ course: vi.fn(), tasks: vi.fn(), results: vi.fn(), announcements: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock('@/features/catalog/service', () => ({ getCourse: mocks.course }));
vi.mock('@/features/workspace-ui/learner/canvas-read.server', () => ({
  dashboardTasks: mocks.tasks, dashboardResults: mocks.results, dashboardAnnouncements: mocks.announcements,
}));
vi.mock('@/features/workspace-ui/learner/LearnerDashboardView', () => ({ LearnerDashboardView: vi.fn() }));
vi.mock('@/features/workspace-ui/ui/TraceRail', () => ({ TraceRail: vi.fn() }));
vi.mock('@/features/workspace-ui/learner/activity.server', () => ({ learnerActivitySeries: vi.fn() }));

import { buildDashboardData, LearnerDashboardBench } from '@/features/workspace-ui/learner/dashboard.server';
import type { LearnerHomeSummary } from '@/features/learner/summary';

const actor = { userId: 'learner-owner', roles: [] };
const now = new Date('2026-11-05T12:00:00Z');
const lesson = { courseId: 'course-owned', courseTitle: 'Owned course', itemId: 'lesson-first', itemTitle: 'First lesson', kind: 'lesson' as const };
const summary: LearnerHomeSummary = {
  rewards: { profile: { displayName: 'Learner', handle: null, avatarUrl: null, locale: 'en', profilePublic: false }, xpTotal: 0,
    streak: { current: 0, longest: 0, lastActiveDate: null }, certificates: [] },
  continueLearning: lesson, nextRequired: lesson, upcomingExam: null, feedback: null, recommendedOpportunity: null,
};
const catalog = [{ id: 'course-owned', title: 'Owned course', level: 'foundation', enrollment: { status: 'active' } }];
const detail = { id: 'course-owned', enrollment: { enrolledAt: '2026-11-01T00:00:00Z' },
  progress: { completedItems: 0, totalItems: 3 }, outline: { modules: [{ title: 'Module', items: [
    { id: 'lesson-first', title: 'First lesson', type: 'lesson', required: true, status: 'not_started' },
    { id: 'assignment-optional', title: 'Optional assignment', type: 'assignment', required: false, status: 'not_started' },
    { id: 'exam-active', title: 'Active exam', type: 'exam', required: true, status: 'in_progress' },
  ] }] } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.course.mockResolvedValue(detail);
  mocks.tasks.mockResolvedValue(null);
  mocks.results.mockResolvedValue([]);
  mocks.announcements.mockResolvedValue([]);
});

describe('dashboard resume server metadata', () => {
  it('carries confirmed active-exam identity into the existing resume action without replacing progress or adding a timer', async () => {
    const active = { ...lesson, itemId: 'exam-active', itemTitle: 'Active exam', kind: 'exam' as const,
      attemptId: 'attempt-owned', courseVersionId: 'version-pinned', startedAt: '2026-11-05T10:00:00Z' };
    const data = await buildDashboardData({ actor, locale: 'en', summary: { ...summary, continueLearning: active },
      catalog: catalog as never, name: 'Learner', now });
    expect(data.resume).toMatchObject({ title: 'Active exam', href: '/app/courses/course-owned/items/exam-active',
      kind: 'exam', itemId: 'exam-active', attemptId: 'attempt-owned', progress: { completed: 0, total: 3, band: null, due: null } });
    expect(data.exam).toBeNull();
    expect(data.resume).not.toHaveProperty('deadlineAt');
    expect(data.resume).not.toHaveProperty('countdown');
    expect(data.state).toBe('resume');
  });

  it('keeps the existing lesson fallback and progress when the optional task read is unavailable', async () => {
    const element = await LearnerDashboardBench({ actor, locale: 'en', summary, catalog: catalog as never, name: 'Learner' });
    expect(element.props.tasks).toBeNull();
    expect(element.props.data.resume).toMatchObject({ title: 'First lesson', href: '/app/courses/course-owned/items/lesson-first',
      kind: 'lesson', itemId: 'lesson-first', progress: { completed: 0, total: 3 } });
    expect(element.props.data.resume).not.toHaveProperty('attemptId');
    expect(element.props.data.state).toBe('resume');
  });
});

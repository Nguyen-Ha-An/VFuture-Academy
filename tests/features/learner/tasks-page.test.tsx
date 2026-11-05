// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ locale: 'en', tasks: vi.fn(), user: vi.fn(async () => ({ id: 'learner-1' })) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => mocks.locale }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.user }));
vi.mock('@/features/coursework/service', () => ({ listCourseTasks: mocks.tasks }));
import LearnerTasksPage from '@/app/app/tasks/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.locale = 'en'; });

describe('all learner tasks', () => {
  it('keeps unscheduled, submitted, completed and actionable tasks from the authorized read model', async () => {
    mocks.tasks.mockResolvedValue(['not_started', 'submitted', 'approved'].map((status, index) => ({ id: String(index), title: `Task ${index}`, courseTitle: 'Course', href: `/app/courses/a/items/${index}`, dueAt: null, late: null, status, kind: 'assignment' })));
    render(await LearnerTasksPage());
    expect(mocks.tasks).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, { locale: 'en' });
    const region = screen.getByRole('region', { name: 'All tasks' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('No due date')).toHaveLength(3);
    expect(screen.getByText('Submitted')).toBeVisible();
    expect(screen.getByText('Completed')).toBeVisible();
  });
  it.each(['en', 'vi'])('separates the empty state from a read failure in %s', async locale => {
    mocks.locale = locale;
    mocks.tasks.mockResolvedValue([]);
    const view = render(await LearnerTasksPage());
    const empty = locale === 'en' ? 'Your courses have no assignments or exams yet.' : 'Các khóa học của bạn chưa có bài tập hoặc bài thi.';
    const unavailable = locale === 'en' ? 'This information could not be loaded. Please try again.' : 'Không tải được thông tin. Vui lòng thử lại.';
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByText(unavailable)).not.toBeInTheDocument();
    view.unmount();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.tasks.mockRejectedValue(new Error('unavailable'));
    render(await LearnerTasksPage());
    expect(screen.getByText(unavailable)).toBeVisible();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(mocks.tasks).toHaveBeenLastCalledWith({ userId: 'learner-1', roles: [] }, { locale });
    log.mockRestore();
  });
});

// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCourse: vi.fn(), getCourseTeachers: vi.fn(async () => ({ courseId: "course-1", branchId: "historical", branchScopeKnown: true, revision: 1, teachers: [{ displayName: "Teacher Lan", role: "primary" }] })), requireUser: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('not found'); }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'learner.course.continue': 'Continue learning', 'learner.course.review': 'Review course', 'learner.course.back': 'Back to courses', 'learner.course.outline': 'Course outline',
      'learner.course.progress': `${values?.done} of ${values?.total} items complete`,
      'learner.course.required': 'Required', 'learner.course.optional': 'Optional',
      'learner.course.skills': 'Skills', 'learner.course.requirements': 'Completion requirements',
      'learner.focus.courseInformation': 'Course information',
      'learner.enums.status.completed': 'Completed', 'learner.enums.status.in_progress': 'In progress',
      'learner.enums.status.not_started': 'Not started', 'learner.enums.kind.lesson': 'Lesson',
    };
    return messages[`${namespace}.${key}`] ?? key;
  }),
}));
vi.mock('@/features/teaching/assignments', () => ({ getCourseTeachers: mocks.getCourseTeachers }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/coursework/service', () => ({ listCourseTasks: vi.fn(async () => []), listCourseResults: vi.fn(async () => []), listLearningAnnouncements: vi.fn(async () => []), listLearningCalendar: vi.fn(async () => ({ events: [] })) }));
vi.mock('@/features/catalog/service', () => ({ getCourse: mocks.getCourse }));
vi.mock('@/features/learner/ui/EnrollButton', () => ({ EnrollButton: () => <button>Enroll</button> }));

import LearnerCoursePage from '@/app/app/courses/[courseId]/page';

// Page-owned breadcrumbs read common.breadcrumbs through next-intl, so pages render inside a provider.
const render = (ui: ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('learner course overview', () => {
  it('localizes course information and exposes full outline rows with status', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'learner-1' });
    mocks.getCourse.mockResolvedValue({
      id: 'course-1', meta: { pathway: 'ai-emerging-technology', title: 'AI', summary: 'Summary', learningOutcomes: [] },
      enrollment: { status: 'active' }, skills: [], completion: { requirements: [] }, progress: { completedItems: 1, totalItems: 2 },
      outline: { modules: [{ id: 'module-1', title: 'Module', items: [
        { id: 'done', title: 'Done', type: 'lesson', required: true, status: 'completed' },
        { id: 'next', title: 'Next', type: 'lesson', required: false, status: 'in_progress' },
      ] }] },
    });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }), searchParams: Promise.resolve({ view: 'modules' }) }));
    expect(mocks.getCourse).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, 'course-1', 'en');
    expect(screen.getByRole('link', { name: /Done.*Lesson.*Required.*Completed/i })).toHaveAttribute('href', '/app/courses/course-1/items/done');
    expect(screen.getByRole('link', { name: /Next.*Lesson.*Optional.*In progress/i })).toHaveAttribute('href', '/app/courses/course-1/items/next');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI');
    const completedRow = screen.getByRole('link', { name: /Done.*Lesson.*Required.*Completed/i });
    // The type icon is decorative; the complete row still exposes its localized kind and state.
    expect(completedRow.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(completedRow.firstElementChild?.querySelector('svg')).not.toBeNull();
    expect(within(completedRow).getByText('Completed')).toBeVisible();
    const disclosure = screen.getByRole('heading', { name: 'Module', level: 3 }).closest('details')!;
    expect(within(disclosure).getAllByRole('link')).toHaveLength(2);
    cleanup();
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(mocks.getCourseTeachers).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, 'course-1');
    expect(screen.getByText('Teacher Lan')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Course information' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/app/courses/course-1/items/next');
  });

  it('uses Review course for completed enrollment and the first item', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'learner-1' });
    mocks.getCourse.mockResolvedValue({
      id: 'course-1', meta: { pathway: 'ai-emerging-technology', title: 'AI', summary: 'Summary', learningOutcomes: [] },
      enrollment: { status: 'completed' }, skills: [], completion: { requirements: [] }, progress: { completedItems: 1, totalItems: 1 },
      outline: { modules: [{ id: 'module-1', title: 'Module', items: [{ id: 'first', title: 'First', type: 'lesson', required: true, status: 'completed' }] }] },
    });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(screen.getByRole('link', { name: 'Review course' })).toHaveAttribute('href', '/app/courses/course-1/items/first');
  });
});


it.each(['completed', 'active'])('chooses the correct CTA with unfinished optional work for %s enrollment', async (status) => {
  mocks.requireUser.mockResolvedValue({ id: 'learner-1' });
  mocks.getCourse.mockResolvedValue({
    id: 'course-1', meta: { pathway: 'ai-emerging-technology', title: 'AI', summary: 'Summary', learningOutcomes: [] },
    enrollment: { status }, skills: [], completion: { requirements: [] }, progress: { completedItems: 1, totalItems: 2 },
    outline: { modules: [{ id: 'module-1', title: 'Module', items: [
      { id: 'first', title: 'First', type: 'lesson', required: true, status: 'completed' },
      { id: 'optional', title: 'Optional', type: 'lesson', required: false, status: 'not_started' },
    ] }] },
  });
  render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
  expect(screen.getByRole('link', { name: status === 'completed' ? 'Review course' : 'Continue learning' })).toHaveAttribute('href', `/app/courses/course-1/items/${status === 'completed' ? 'first' : 'optional'}`);
});

it.each(['completed', 'active'])('does not create an item CTA for an empty %s course', async (status) => {
  mocks.requireUser.mockResolvedValue({ id: 'learner-1' });
  mocks.getCourse.mockResolvedValue({
    id: 'course-1', meta: { pathway: 'ai-emerging-technology', title: 'AI', summary: 'Summary', learningOutcomes: [] },
    enrollment: { status }, skills: [], completion: { requirements: [] }, progress: { completedItems: 0, totalItems: 0 },
    outline: { modules: [] },
  });
  render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
  expect(screen.queryByRole('link', { name: /Review course|Continue learning/ })).not.toBeInTheDocument();
});

// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCourse: vi.fn(), requireUser: vi.fn() }));
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
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
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
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(screen.getByText('Course information')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Done.*Lesson.*Required.*Completed/i })).toHaveAttribute('href', '/app/courses/course-1/items/done');
    expect(screen.getByRole('link', { name: /Next.*Lesson.*Optional.*In progress/i })).toBeInTheDocument();
    // .vf-title wraps long titles (overflow-wrap: anywhere) inside the shared page head.
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('vf-title');
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveClass('vf-page-head');
    const completedRow = screen.getByRole('link', { name: /Done.*Lesson.*Required.*Completed/i });
    // Mono kind code (decorative), then the wrapping title block, then the status tag.
    expect(completedRow.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(completedRow.firstElementChild).toHaveTextContent('LSN');
    expect(completedRow.children[1]).toHaveClass('min-w-0', 'break-words');
    expect(completedRow.lastElementChild).toHaveClass('shrink-0');
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

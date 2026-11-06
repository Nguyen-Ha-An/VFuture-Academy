// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCourse: vi.fn(), getCourseTeachers: vi.fn(async () => ({ courseId: "course-1", branchId: "historical", branchScopeKnown: true, revision: 1, teachers: [{ displayName: "Teacher Lan", role: "primary" }] })), listCatalog: vi.fn(), requireUser: vi.fn() }));
const messages: Record<string, string> = {
  'learner.course.back': 'Back to courses', 'learner.course.outcomes': 'Learning outcomes', 'learner.course.skills': 'Skills', 'learner.course.outline': 'Course outline', 'learner.course.outlinePreview': 'Preview the course outline. Enroll to open the lessons and activities.', 'learner.course.previewLocked': 'Available after enrollment', 'learner.course.requirements': 'Completion requirements', 'learner.course.enrolled': 'Enrolled', 'learner.course.continue': 'Continue learning', 'learner.course.review': 'Review course', 'learner.course.required': 'Required', 'learner.course.optional': 'Optional', 'learner.course.requirementPending': 'Not yet met', 'learner.course.requirementMet': 'Met', 'learner.course.nextStep': 'Next step', 'learner.enums.pathway.core-future-skills': 'Core Future Skills', 'learner.course.requirementsMap.all_items': 'Complete every required item', 'learner.focus.courseInformation': 'Course information', 'learner.focus.courses': 'Courses', 'learner.enums.pathway.ai-emerging-technology': 'AI & Emerging Technology', 'learner.enums.kind.lesson': 'Lesson', 'learner.enums.status.not_started': 'Not started', 'learner.enums.status.in_progress': 'In progress', 'learner.enums.status.completed': 'Completed',
};
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en'), getTranslations: vi.fn(async (namespace: string) => (key: string, values?: Record<string, unknown>) => {
  if (`${namespace}.${key}` === 'learner.course.progress') return `${values?.done} of ${values?.total} items complete`;
  if (`${namespace}.${key}` === 'learner.course.requirementProgress') return `${values?.done} of ${values?.total}`;
  return messages[`${namespace}.${key}`] ?? key;
}) }));
vi.mock('@/features/teaching/assignments', () => ({ getCourseTeachers: mocks.getCourseTeachers }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/coursework/service', () => ({ listCourseTasks: vi.fn(async () => []), listCourseResults: vi.fn(async () => []), listLearningAnnouncements: vi.fn(async () => []), listLearningCalendar: vi.fn(async () => ({ events: [] })) }));
vi.mock('@/features/catalog/service', () => ({ getCourse: mocks.getCourse, listCatalog: mocks.listCatalog }));
vi.mock('@/features/learner/ui/EnrollButton', () => ({ EnrollButton: ({ prerequisites = [] }: { prerequisites?: Array<{ id: string; label: string }> }) => <button data-prerequisites={prerequisites.map((course) => `${course.id}=${course.label}`).join(',')}>Enroll</button> }));
import LearnerCoursePage from '@/app/app/courses/[courseId]/page';

// Page-owned breadcrumbs read common.breadcrumbs through next-intl, so pages render inside a provider.
const render = (ui: ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);

const item = (id: string, status: 'not_started' | 'in_progress' | 'completed', required = true) => ({ id, title: id, type: 'lesson' as const, status, required });
const course = (enrollment: { status: 'active' | 'completed' } | null, items = [item('first', 'completed'), item('second', 'not_started', false)]) => ({ id: 'course-1', meta: { pathway: 'ai-emerging-technology', title: 'Course title', summary: 'Course summary', learningOutcomes: [] }, outline: { modules: [{ id: 'module-1', title: 'Module one', items }] }, skills: [], enrollment: enrollment && { id: 'enrollment-1', ...enrollment, enrolledAt: null, completedAt: null }, progress: { completedItems: 1, totalItems: items.length, items: {} }, completion: { requirements: [], complete: enrollment?.status === 'completed', certificate: false, completedAt: null } });
beforeEach(() => { mocks.requireUser.mockResolvedValue({ id: 'learner-1' }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('learner course overview', () => {
  it('reviews the first item for completed enrollment even when an optional item is unfinished', async () => {
    mocks.getCourse.mockResolvedValue(course({ status: 'completed' }));
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(mocks.getCourseTeachers).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, 'course-1');
    expect(screen.getByText('Teacher Lan')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review course' })).toHaveAttribute('href', '/app/courses/course-1/items/first');
  });
  it('continues the first incomplete item for active enrollment and has no item CTA for an empty outline', async () => {
    mocks.getCourse.mockResolvedValue(course({ status: 'active' }));
    const active = render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(screen.getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/app/courses/course-1/items/second');
    active.unmount();
    mocks.getCourse.mockResolvedValue(course({ status: 'active' }, []));
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(screen.queryByRole('link', { name: 'Continue learning' })).toBeNull();
  });
  it('uses localized information and makes every enrolled outline row a complete status link', async () => {
    mocks.getCourse.mockResolvedValue(course({ status: 'active' }));
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }), searchParams: Promise.resolve({ view: 'modules' }) }));
    const row = screen.getByRole('link', { name: /first.*Lesson.*Required.*Completed/i });
    expect(row).toHaveAttribute('href', '/app/courses/course-1/items/first');
    expect(within(row).getByText('Completed')).toBeVisible();
  });
  it('returns to the normalized catalog context without an oversized heading', async () => {
    mocks.getCourse.mockResolvedValue(course({ status: 'active' }));
    render(await LearnerCoursePage({
      params: Promise.resolve({ courseId: 'course-1' }),
      searchParams: Promise.resolve({ tab: 'discover', level: 'foundation', difficulty: 'invalid', language: 'en' }),
    } as Parameters<typeof LearnerCoursePage>[0]));

    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/app/courses?tab=discover&level=foundation&language=en');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveClass('sm:text-5xl');
  });

  it('previews every module before enrollment without exposing item links', async () => {
    mocks.getCourse.mockResolvedValue({
      ...course(null),
      meta: { ...course(null).meta, learningOutcomes: ['Explain the model'] },
      completion: { ...course(null).completion, requirements: [{ rule: { type: 'all_items' }, satisfied: false }] },
    });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));

    expect(screen.getByRole('button', { name: 'Enroll' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Course outline' })).toBeVisible();
    expect(screen.getByText('Preview the course outline. Enroll to open the lessons and activities.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Module one' })).toBeVisible();
    expect(screen.getByText('first')).toBeVisible();
    expect(screen.getByText('second')).toBeVisible();
    expect(screen.queryByRole('link', { name: /first.*Lesson/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learning outcomes' })).toBeVisible();
    expect(screen.getByText('Explain the model')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Completion requirements' })).toBeVisible();
    expect(screen.getByText('Complete every required item')).toBeVisible();
  });

  it('shows enrolled progress with real item counts and keeps outcomes visible', async () => {
    mocks.getCourse.mockResolvedValue({
      ...course({ status: 'active' }),
      meta: { ...course({ status: 'active' }).meta, learningOutcomes: ['Explain the model'] },
    });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));

    // A ToleranceBar (role=img) replaces the rounded progressbar pill.
    expect(screen.getByRole('img', { name: '1 of 2 items complete' })).toHaveClass('vf-tol');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Explain the model')).toBeVisible();
  });

  it('shows the pathway or authored course code in the Canvas course heading', async () => {
    mocks.getCourse.mockResolvedValue(course({ status: 'active' }));
    const plain = render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(plain.container.querySelector('.canvas-course-heading .canvas-course-eyebrow')).toHaveTextContent(/^AI & Emerging Technology$/);
    plain.unmount();

    mocks.getCourse.mockResolvedValue({ ...course({ status: 'active' }), meta: { ...course({ status: 'active' }).meta, code: 'AI-101' } });
    const coded = render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(coded.container.querySelector('.canvas-course-heading .canvas-course-eyebrow')).toHaveTextContent(/^AI-101$/);
  });

  it('groups required and optional activities in a collapsible module and retains overview requirements and the continue action', async () => {
    const user = userEvent.setup();
    mocks.getCourse.mockResolvedValue({
      ...course({ status: 'active' }),
      meta: { ...course({ status: 'active' }).meta, learningOutcomes: ['Explain the model'] },
      completion: { ...course({ status: 'active' }).completion, requirements: [{ rule: { type: 'all_items' }, satisfied: true, progress: { done: 2, total: 2 } }] },
    });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }), searchParams: Promise.resolve({ view: 'modules' }) }));
    const moduleHeading = screen.getByRole('heading', { level: 3, name: 'Module one' });
    const disclosure = moduleHeading.closest('details')!;
    expect(disclosure).toHaveAttribute('open');
    const required = within(disclosure).getByRole('link', { name: /first.*Lesson.*Required.*Completed/i });
    const optional = within(disclosure).getByRole('link', { name: /second.*Lesson.*Optional.*Not started/i });
    expect(required).toHaveAttribute('href', '/app/courses/course-1/items/first');
    expect(optional).toHaveAttribute('href', '/app/courses/course-1/items/second');
    await user.click(disclosure.querySelector('summary')!);
    expect(disclosure).not.toHaveAttribute('open');
    expect(required).not.toBeVisible();
    await user.click(disclosure.querySelector('summary')!);
    expect(required).toBeVisible();
    expect(optional).toBeVisible();
    cleanup();
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    const requirements = screen.getByRole('region', { name: 'Completion requirements' });
    expect(within(requirements).getByText('Met')).toBeVisible();
    expect(within(requirements).getByText('2 of 2')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue learning' })).toHaveAttribute('href', '/app/courses/course-1/items/second');
    expect(screen.getByRole('heading', { name: 'Next step' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Course information' })).toBeVisible();
  });

  it('labels prerequisite links with the authored code (else title) for an unenrolled course', async () => {
    mocks.getCourse.mockResolvedValue({ ...course(null), meta: { ...course(null).meta, prerequisites: ['ai-101', 'data-201', 'gone'] } });
    mocks.listCatalog.mockResolvedValue([{ id: 'ai-101', code: 'AI-101', title: 'AI basics' }, { id: 'data-201', title: 'Data basics' }]);
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));

    expect(screen.getByRole('button', { name: 'Enroll' })).toHaveAttribute('data-prerequisites', 'ai-101=AI-101,data-201=Data basics,gone=gone');
  });

  it('skips the catalog lookup for an enrolled course and survives a catalog failure', async () => {
    mocks.getCourse.mockResolvedValue({ ...course({ status: 'active' }), meta: { ...course(null).meta, prerequisites: ['ai-101'] } });
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(mocks.listCatalog).not.toHaveBeenCalled();
    cleanup();

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getCourse.mockResolvedValue({ ...course(null), meta: { ...course(null).meta, prerequisites: ['ai-101'] } });
    mocks.listCatalog.mockRejectedValue(new Error('offline'));
    render(await LearnerCoursePage({ params: Promise.resolve({ courseId: 'course-1' }) }));
    expect(screen.getByRole('button', { name: 'Enroll' })).toHaveAttribute('data-prerequisites', 'ai-101=ai-101');
    error.mockRestore();
  });
});

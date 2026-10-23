// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCourse: vi.fn(),
  getItemPayload: vi.fn(),
  itemPlayer: vi.fn(),
  assignmentSession: vi.fn(),
  readItemActivitySummary: vi.fn(),
  requireUser: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('not found'); }),
  redirect: vi.fn((location: string) => { throw new Error(`redirect:${location}`); }),
  useRouter: () => ({ push: mocks.push }),
}));
// Real English copy (main catalog plus bench) for the server page and its client parts.
async function englishTranslator(namespace?: string) {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl');
  const { default: en } = await import('@/messages/en.json');
  const { withBenchMessages } = await import('@/messages/bench');
  return createTranslator({ locale: 'en', messages: withBenchMessages(en, 'en'), namespace: namespace as never }) as unknown as (key: string, values?: Record<string, unknown>) => string;
}
const translators = vi.hoisted(() => new Map<string, (key: string, values?: Record<string, unknown>) => string>());
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => englishTranslator(namespace)),
}));
vi.mock('next-intl', async () => {
  for (const namespace of ['learner.focus', 'bench.learner.activity', 'bench.learner.activity.state', 'bench.shared.theme']) translators.set(namespace, await englishTranslator(namespace));
  return { useTranslations: (namespace: string) => translators.get(namespace) ?? ((key: string) => key) };
});
vi.mock('@/components/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/features/catalog/service', () => ({ getCourse: mocks.getCourse }));
vi.mock('@/features/learner/summary', () => ({ readItemActivitySummary: mocks.readItemActivitySummary }));
vi.mock('@/features/learner/ui/ItemPlayer', () => ({ ItemPlayer: (props: unknown) => { mocks.itemPlayer(props); return <div>player</div>; } }));
vi.mock('@/features/progress/service', () => ({ getItemPayload: mocks.getItemPayload }));
vi.mock('@/features/submissions/service', () => ({ session: mocks.assignmentSession }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));

import LearnerItemPage from '@/app/app/courses/[courseId]/items/[itemId]/page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('learner item page', () => {
  it('renders the localized item title as the page heading', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'lesson', id: 'lesson-1', title: 'What is AI?', blocks: [] },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ items: [{ id: 'lesson-1' }] }] },
      progress: { items: {}, completedItems: 0, totalItems: 1 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: 'view' });
    mocks.assignmentSession.mockResolvedValue(null);

    const view = render(await LearnerItemPage({
      params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-1' }),
    }));

    expect(screen.getByRole('heading', { level: 1, name: 'What is AI?' })).toBeInTheDocument();
    expect(view.container.querySelector('.lg\\:sticky')).toBeNull();
    expect(view.container.querySelector('[data-learning-kind="lesson"]')).toHaveAttribute('data-width', 'reading');
    expect(view.container.querySelector('[class*="max-w-"]')).toBeNull();
  });

  it('keeps the reader outline closed until the learner opens its accessible dialog', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'lesson', id: 'lesson-2', title: 'Models', blocks: [] },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: {
        modules: [
          { id: 'module-1', title: 'Foundations', items: [{ id: 'lesson-1', title: 'What is AI?', type: 'lesson', status: 'completed' }] },
          { id: 'module-2', title: 'Models', items: [
            { id: 'lesson-2', title: 'Models', type: 'lesson', status: 'in_progress' },
            { id: 'lesson-3', title: 'Practice', type: 'lesson', status: 'not_started' },
          ] },
        ],
      },
      progress: { items: { 'lesson-1': 'completed', 'lesson-2': 'in_progress', 'lesson-3': 'not_started' }, completedItems: 1, totalItems: 3 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: 'activities' });
    mocks.assignmentSession.mockResolvedValue(null);

    render(await LearnerItemPage({
      params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-2' }),
    }));

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^course outline$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Models/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: /close course outline/i }));
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute('href', '/app/courses/ai-foundations/items/lesson-1');
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute('href', '/app/courses/ai-foundations/items/lesson-3');
  });

  it('hydrates a standalone assignment with an explicit null block locator', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'assignment', id: 'assignment-1', title: 'Project', submission: { accepts: ['text'] } },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ items: [{ id: 'assignment-1' }] }] },
      progress: { items: {}, completedItems: 0, totalItems: 1 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: null });
    const hydrated = {
      locator: { courseId: 'ai-foundations', itemId: 'assignment-1', blockId: null },
      courseVersionId: 'version-1', attemptsUsed: 0, submissions: [],
      action: { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 },
    };
    mocks.assignmentSession.mockResolvedValue(hydrated);

    render(await LearnerItemPage({ params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'assignment-1' }) }));

    expect(mocks.assignmentSession).toHaveBeenCalledWith(
      { userId: 'user-1', roles: [] },
      { courseId: 'ai-foundations', itemId: 'assignment-1', blockId: null },
    );
    expect(mocks.itemPlayer.mock.calls[0]?.[0]).toMatchObject({ assignmentSessions: { 'assignment-1': hydrated } });
  });

  it('hydrates a nested inline assignment by its explicit block id', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: {
        kind: 'lesson', id: 'lesson-1', title: 'Lesson',
        blocks: [{ type: 'callout', body: { blocks: [{ type: 'assignment', id: 'inline-work', title: 'Work' }] } }],
      },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ items: [{ id: 'lesson-1' }] }] },
      progress: { items: {}, completedItems: 0, totalItems: 1 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: 'activities' });
    const hydrated = {
      locator: { courseId: 'ai-foundations', itemId: 'lesson-1', blockId: 'inline-work' },
      courseVersionId: 'version-1', attemptsUsed: 0, submissions: [],
      action: { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 },
    };
    mocks.assignmentSession.mockResolvedValue(hydrated);

    render(await LearnerItemPage({ params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-1' }) }));

    expect(mocks.assignmentSession).toHaveBeenCalledWith(
      { userId: 'user-1', roles: [] },
      { courseId: 'ai-foundations', itemId: 'lesson-1', blockId: 'inline-work' },
    );
    expect(mocks.itemPlayer.mock.calls[0]?.[0]).toMatchObject({ assignmentSessions: { 'inline-work': hydrated } });
  });

  it('gives the lesson a course context and named adjacent items without duplicating the player title', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'lesson', id: 'lesson-2', title: 'Models', blocks: [] },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ id: 'module-1', title: 'Foundations', items: [
        { id: 'lesson-1', title: 'What is AI?', type: 'lesson', status: 'completed' },
        { id: 'lesson-2', title: 'Models', type: 'lesson', status: 'in_progress' },
        { id: 'exam-1', title: 'Final exam', type: 'exam', status: 'not_started' },
      ] }] },
      progress: { items: {}, completedItems: 1, totalItems: 3 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: 'view' });

    render(await LearnerItemPage({ params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-2' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Models' })).toBeInTheDocument();
    expect(screen.getByText('AI Foundations')).toBeInTheDocument();
    expect(screen.getByText('Foundations')).toBeInTheDocument();
    expect(screen.getByText('Item 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /previous.*What is AI\?/i })).toHaveAttribute('href', '/app/courses/ai-foundations/items/lesson-1');
    expect(screen.getByRole('link', { name: /next.*Final exam/i })).toHaveAttribute('href', '/app/courses/ai-foundations/items/exam-1');
    expect(mocks.itemPlayer.mock.calls[0]?.[0]).not.toHaveProperty('refined');
  });

  it('frames the item with the focus bar, one head and a kind-kicked pager', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'lesson', id: 'lesson-2', title: 'Models', blocks: [], estimatedMinutes: 12 },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ id: 'module-1', title: 'Foundations', items: [
        { id: 'lesson-1', title: 'What is AI?', type: 'lesson', status: 'completed' },
        { id: 'lesson-2', title: 'Models', type: 'lesson', status: 'in_progress' },
        { id: 'exam-1', title: 'Final exam', type: 'exam', status: 'not_started' },
      ] }] },
      progress: { items: { 'lesson-1': 'completed', 'lesson-2': 'in_progress' }, completedItems: 1, totalItems: 3 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: 'view' });

    const view = render(await LearnerItemPage({ params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-2' }) }));

    const bar = screen.getByRole('navigation', { name: 'Activity' });
    expect(bar.tagName).toBe('NAV');
    expect(view.container.querySelector('header a[href="/app"], nav[aria-label="Activity"] a[href="/app"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to course: AI Foundations' })).toHaveAttribute('href', '/app/courses/ai-foundations');
    expect(view.container.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('progressbar', { name: '1 of 3 items complete' })).toHaveAttribute('aria-valuenow', '1');
    const head = screen.getByRole('heading', { level: 1, name: 'Models' }).closest('header')!;
    expect(head).toHaveTextContent('Lesson · Foundations');
    expect(head).toHaveTextContent('12 min');
    expect(head.querySelector('.vf-tag')).toHaveTextContent('In progress');
    expect(screen.getByText('Item 2 of 3')).toHaveClass('sr-only');
    const pager = screen.getByRole('navigation', { name: 'Previous and next' });
    expect(pager).toHaveTextContent('Previous · Lesson');
    expect(pager).toHaveTextContent('Next · Exam');
    expect(mocks.itemPlayer.mock.calls[0]?.[0]).toMatchObject({ courseHref: '/app/courses/ai-foundations', next: { href: '/app/courses/ai-foundations/items/exam-1', title: 'Final exam' } });
  });

  it('lets the exam use the wider workspace while keeping its focused outline', async () => {
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.getItemPayload.mockResolvedValue({
      courseVersionId: 'version-1',
      item: { kind: 'exam', id: 'exam-1', title: 'Final exam', settings: {}, sections: [] },
      activityState: {},
    });
    mocks.getCourse.mockResolvedValue({
      enrollment: { id: 'enrollment-1' },
      meta: { title: 'AI Foundations' },
      outline: { modules: [{ id: 'module-1', title: 'Foundations', items: [
        { id: 'exam-1', title: 'Final exam', type: 'exam', status: 'not_started' },
      ] }] },
      progress: { items: {}, completedItems: 0, totalItems: 1 },
    });
    mocks.readItemActivitySummary.mockResolvedValue({ attemptsUsed: 0, completionMode: null });

    const view = render(await LearnerItemPage({ params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'exam-1' }) }));

    expect(view.container.querySelector('[data-learning-kind="exam"]')).toHaveAttribute('data-width', 'frame');
    expect(view.container.querySelector('.max-w-\\[760px\\]')).toBeNull();
    expect(screen.getByRole('button', { name: /^course outline$/i })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LessonRuntime } from '@/content-engine/render/runtime';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';
import { ActivityProgressProvider, ActivityProgressReadout } from '@/features/workspace-ui/learner/activity/ActivityProgress';

const messages = withBenchMessages(en, 'en');

const renderMocks = vi.hoisted(() => ({ registerAll: vi.fn(), lessonProps: vi.fn() }));

vi.mock('@/content-engine/render', () => ({
  registerAll: renderMocks.registerAll,
  AssignmentRenderer: ({ assignment, runtime }: { assignment: { id: string }; runtime: LessonRuntime }) => (
    <output data-testid="assignment-state">{JSON.stringify(runtime.getBlockState(assignment.id))}</output>
  ),
  LessonRenderer: (props: { runtime: LessonRuntime; hideTitle?: boolean }) => {
    renderMocks.lessonProps(props);
    const { runtime } = props;
    useEffect(() => runtime.markViewed(), [runtime]);
    return <><output>{JSON.stringify(runtime.getBlockState('reflection-1'))}</output><button type="button" onClick={() => runtime.setBlockState('reflection-1', { value: 'Ready', completed: true })}>Complete activity</button></>;
  },
}));
vi.mock('@/features/exams/ui/ExamFlow', () => ({ ExamFlow: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ItemPlayer } from '@/features/learner/ui/ItemPlayer';

const assignmentSession = (submittedAt: string, text: string) => ({
  locator: { courseId: 'ai-foundations', itemId: 'assignment-1', blockId: null },
  courseVersionId: 'version-1',
  attemptsUsed: 1,
  submissions: [{
    submissionId: 'submission-1', attemptNo: 1, status: 'submitted' as const,
    submittedAt, payload: { text }, files: [],
  }],
  action: { allowed: true as const, kind: 'revision' as const, expectedLatestSubmissionId: 'submission-1', nextAttemptNo: 2 },
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('learner item player', () => {
  it('registers all lesson renderers explicitly', () => {
    expect(renderMocks.registerAll).toHaveBeenCalledOnce();
  });

  it('lets the page own the lesson heading while retaining its live runtime', () => {
    renderMocks.lessonProps.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { status: 'in_progress' } }))));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
        />
      </NextIntlClientProvider>,
    );

    expect(renderMocks.lessonProps.mock.calls[0]?.[0]).toMatchObject({ hideTitle: true, presentation: true });
    expect(screen.getByRole('button', { name: messages.learner.item.markComplete })).toBeInTheDocument();
  });

  it('marks fallback content with its render locale while controls keep the UI locale', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { status: 'in_progress' } }))));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          contentLocale="vi"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'Trí tuệ nhân tạo', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Complete activity' }).closest('[lang]')).toHaveAttribute('lang', 'vi');
    expect(screen.getByRole('button', { name: messages.learner.item.markComplete }).closest('[lang="vi"]')).toBeNull();
  });

  it('hydrates the runtime from server activity state and disposes it on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'in_progress' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const view = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{ 'reflection-1': { value: 'My answer', completed: true } }}
          completionMode="activities"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('My answer');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/viewed', expect.any(Object)));

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('preserves an autosaved assignment draft that is newer than the latest submission', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="assignment-1"
          locale="en"
          item={{ kind: 'assignment', id: 'assignment-1', title: 'Reflection' }}
          activityState={{
            'assignment-1': {
              status: 'draft',
              payload: { text: 'newer autosave' },
              updatedAt: '2026-09-03T12:00:00Z',
            },
          }}
          completionMode={null}
          completed={false}
          attemptsUsed={0}
          assignmentSessions={{ 'assignment-1': assignmentSession('2026-09-03T11:00:00Z', 'older submission') }}
          submissions={[{
            status: 'submitted',
            payload: { text: 'older submission' },
            submittedAt: '2026-09-03T11:00:00Z',
          }]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId('assignment-state')).toHaveTextContent('newer autosave');
    expect(screen.getByTestId('assignment-state')).not.toHaveTextContent('older submission');
  });

  it('injects the latest submission when it is newer than the autosaved assignment draft', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="assignment-1"
          locale="en"
          item={{ kind: 'assignment', id: 'assignment-1', title: 'Reflection' }}
          activityState={{
            'assignment-1': {
              status: 'draft',
              payload: { text: 'older autosave' },
              updatedAt: '2026-09-03T10:00:00Z',
            },
          }}
          completionMode={null}
          completed={false}
          attemptsUsed={0}
          assignmentSessions={{ 'assignment-1': assignmentSession('2026-09-03T11:00:00Z', 'newer submission') }}
          submissions={[{
            status: 'submitted',
            payload: { text: 'newer submission' },
            submittedAt: '2026-09-03T11:00:00Z',
          }]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId('assignment-state')).toHaveTextContent('newer submission');
    expect(screen.getByTestId('assignment-state')).not.toHaveTextContent('older autosave');
  });

  it('uses full PostgreSQL fractional precision when the submission is newer than the draft', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="assignment-1"
          locale="en"
          item={{ kind: 'assignment', id: 'assignment-1', title: 'Reflection' }}
          activityState={{
            'assignment-1': {
              status: 'draft',
              payload: { text: 'Microsecond-older draft' },
              updatedAt: '2026-09-03T11:00:00.123100Z',
            },
          }}
          completionMode={null}
          completed={false}
          attemptsUsed={0}
          assignmentSessions={{ 'assignment-1': assignmentSession('2026-09-03T11:00:00.123900Z', 'Microsecond-newer submission') }}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId('assignment-state')).toHaveTextContent('Microsecond-newer submission');
    expect(screen.getByTestId('assignment-state')).not.toHaveTextContent('Microsecond-older draft');
  });

  it('injects the latest submission when no autosaved assignment state exists', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="assignment-1"
          locale="en"
          item={{ kind: 'assignment', id: 'assignment-1', title: 'Reflection' }}
          activityState={{}}
          completionMode={null}
          completed={false}
          attemptsUsed={0}
          assignmentSessions={{ 'assignment-1': assignmentSession('2026-09-03T11:00:00Z', 'submitted answer') }}
          submissions={[{
            status: 'submitted',
            payload: { text: 'submitted answer' },
            submittedAt: '2026-09-03T11:00:00Z',
          }]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId('assignment-state')).toHaveTextContent('submitted answer');
  });

  it('reflects a successful automatic viewed write in the completion UI', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'completed' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(messages.bench.learner.activity.state.completed)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears an automatic viewed failure when manual completion succeeds', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'WRITE_FAILED', message: 'No' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'completed' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.learner.item.saveError);
    await user.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));

    await waitFor(() => expect(screen.getByText(messages.bench.learner.activity.state.completed)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hands keyboard focus to the next action once mark complete succeeds', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'WRITE_FAILED', message: 'No' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'completed' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
          next={{ href: '/app/courses/ai-foundations/items/models', title: 'Models' }}
        />
      </NextIntlClientProvider>,
    );

    await screen.findByRole('alert');
    const markButton = screen.getByRole('button', { name: messages.learner.item.markComplete });
    markButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('link', { name: 'Next: Models' })).toHaveFocus());
  });

  it('deduplicates a manual completion click while the automatic viewed write is in flight', async () => {
    const user = userEvent.setup();
    let resolveViewed!: (response: Response) => void;
    const viewedResponse = new Promise<Response>((resolve) => { resolveViewed = resolve; });
    const fetchMock = vi.fn(() => viewedResponse);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveViewed(new Response(JSON.stringify({ data: { status: 'completed' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
      await viewedResponse;
    });
    await waitFor(() => expect(screen.getByText(messages.bench.learner.activity.state.completed)).toBeInTheDocument());
  });

  it('does not claim activity-mode completion after a successful viewed write', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'in_progress' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="activities"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
          progress={{ completed: 0, total: 1 }}
        />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByText(messages.learner.item.completed)).not.toBeInTheDocument();
  });

  it('gives the progress bar its own accessible name', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { status: 'in_progress' } }))));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="activities"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
          progress={{ completed: 1, total: 3 }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('progressbar', { name: messages.learner.item.courseProgress })).toHaveAttribute('aria-valuenow', '1');
  });

  it('shows a failed activity write and retries without claiming completion', async () => {
    vi.useFakeTimers();
    let blockWriteSucceeds = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/progress/blocks/')) {
        return blockWriteSucceeds
          ? new Response(JSON.stringify({ data: null }))
          : new Response(JSON.stringify({ error: { code: 'WRITE_FAILED', message: 'No' } }), { status: 503 });
      }
      return new Response(JSON.stringify({ data: { status: 'in_progress' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="activities"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
          progress={{ completed: 0, total: 1 }}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete activity' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });

    expect(screen.getByRole('alert')).toHaveTextContent(messages.learner.item.saveError);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    blockWriteSucceeds = true;
    fireEvent.click(screen.getByRole('button', { name: messages.learner.item.retrySave }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps mark complete available after a failed request and offers retry', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'WRITE_FAILED', message: 'No' },
    }), { status: 503 })));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="what-is-ai"
          locale="en"
          item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
          activityState={{}}
          completionMode="view"
          completed={false}
          attemptsUsed={0}
          submissions={[]}
        />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.learner.item.markError);
    expect(screen.getByRole('button', { name: messages.learner.item.markComplete })).toBeEnabled();
    expect(screen.getByRole('button', { name: messages.learner.item.retrySave })).toBeEnabled();
    expect(screen.queryByText(messages.learner.item.completed)).not.toBeInTheDocument();
  });

  it('reports completion to the activity frame and offers the next item as the primary action', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ActivityProgressProvider initial={{ completed: 1, total: 3 }} status="in_progress">
          <ActivityProgressReadout />
          <ItemPlayer
            courseId="ai-foundations"
            itemId="what-is-ai"
            locale="en"
            item={{ kind: 'lesson', id: 'what-is-ai', title: 'What is AI?', blocks: [] }}
            activityState={{}}
            completionMode="view"
            completed={false}
            attemptsUsed={0}
            progress={{ completed: 1, total: 3 }}
            courseHref="/app/courses/ai-foundations"
            next={{ href: '/app/courses/ai-foundations/items/models', title: 'Models' }}
          />
        </ActivityProgressProvider>
      </NextIntlClientProvider>,
    );

    // Inside the frame the inline progress card gives way to the focus bar readout.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Next: Models' })).toHaveAttribute('href', '/app/courses/ai-foundations/items/models');
    await waitFor(() => expect(screen.getByText(messages.bench.learner.activity.state.completed)).toBeInTheDocument());
    expect(screen.getByText(messages.bench.learner.activity.viewedComplete)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: messages.learner.item.markComplete })).not.toBeInTheDocument();
    // The report runs in a passive effect after the async write, so wait for it.
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2'));
  });

  it('marks an activities lesson complete once the server reports the lesson done', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({
      data: String(url).includes('/progress/blocks/')
        ? { state: {}, completion: { lessons: { 'lesson-1': { complete: true } } } }
        : { status: 'in_progress' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ActivityProgressProvider initial={{ completed: 1, total: 3 }} status="in_progress">
          <ActivityProgressReadout />
          <ItemPlayer
            courseId="ai-foundations"
            itemId="lesson-1"
            locale="en"
            item={{ kind: 'lesson', id: 'lesson-1', title: 'Lesson', blocks: [] }}
            activityState={{}}
            completionMode="activities"
            completed={false}
            attemptsUsed={0}
          />
        </ActivityProgressProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.bench.learner.activity.activitiesRequired)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Complete activity' }));
    await waitFor(() => expect(screen.queryByText(messages.bench.learner.activity.activitiesRequired)).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(messages.bench.learner.activity.state.completed)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2'));
  });

  it('sends the learner back to the course from the last item', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { status: 'in_progress' } }))));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ItemPlayer
          courseId="ai-foundations"
          itemId="last"
          locale="en"
          item={{ kind: 'lesson', id: 'last', title: 'Last', blocks: [] }}
          activityState={{}}
          completionMode="activities"
          completed={false}
          attemptsUsed={0}
          courseHref="/app/courses/ai-foundations"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: messages.bench.learner.activity.backToCourse })).toHaveAttribute('href', '/app/courses/ai-foundations');
    expect(screen.getByText(messages.bench.learner.activity.activitiesRequired)).toBeInTheDocument();
  });
});

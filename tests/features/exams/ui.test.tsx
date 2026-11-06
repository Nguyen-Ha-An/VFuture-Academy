// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompiledItem } from '@/content-engine/compile';
import { createPreviewRuntime, registerAll } from '@/content-engine/render';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { ExamIntro } from '@/features/exams/ui/ExamIntro';
import { ExamFlow } from '@/features/exams/ui/ExamFlow';
import { ExamPlayer } from '@/features/exams/ui/ExamPlayer';
import { ExamReview } from '@/features/exams/ui/ExamReview';
import { createPendingExamDraftStore } from '@/features/exams/ui/pending-draft';
import { examSections, type LearnerExam } from '@/features/exams/ui/types';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import {
  bankSource,
  compileExamFixtures,
  itemContext,
  instructor,
  learner,
  MutableClock,
  withExamSettings,
} from './test-kit';
import { createMemoryExamClient } from './memory-client';

let exam: CompiledItem;

beforeAll(async () => {
  ({ ai: exam } = await compileExamFixtures());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  cleanup();
});

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

function VietnameseProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

async function playerHarness(
  settings: Partial<NonNullable<CompiledItem['grading']['exam']>> = {},
) {
  const item = withExamSettings(exam, {
    shuffleQuestions: false,
    shuffleOptions: false,
    ...settings,
  });
  const renderItem = structuredClone(item.renders.en) as LearnerExam;
  renderItem.settings = { ...renderItem.settings, ...settings };
  const repo = new InMemoryExamRepo();
  const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
  const service = createExamService({
    authorizeStaffAttempt: async () => undefined,
    repo,
    clock,
    track: async () => {},
    bank: bankSource,
    loadItem: async () => itemContext(item),
    isEnrolled: async () => true,
  });
  const client = createMemoryExamClient(
    service,
    learner,
    { courseId: 'ai-foundations', itemId: item.id },
    clock,
  );
  const attempt = await client.start();
  renderItem.sections = examSections(attempt.learner);
  return {
    attempt,
    client,
    clock,
    exam: renderItem,
    repo,
    runtime: createPreviewRuntime(item, 'en'),
    service,
  };
}

describe('ExamIntro', () => {
  it('leads with a TIME / PASS / ATTEMPTS readout, keeps the rest under Rules and starts with a vf-btn', () => {
    const view = render(
      <Provider>
        <ExamIntro exam={exam.renders.en as never} attemptsUsed={1} onStart={vi.fn()} hideTitle />
      </Provider>,
    );
    const readout = view.container.querySelector('.vf-exam-readout')!;
    expect([...readout.querySelectorAll('.vf-kicker')].map((cell) => cell.textContent)).toEqual([en.exam.intro.readout.time, en.exam.intro.readout.pass, en.exam.intro.readout.attempts]);
    expect(readout).toHaveTextContent('1 attempt remaining');
    const rules = screen.getByText(en.exam.intro.rules).closest('details')!;
    expect(rules).not.toHaveAttribute('open');
    expect(rules).toHaveTextContent('Best attempt');
    expect(rules).toHaveTextContent('Fullscreen not required');
    const start = screen.getByRole('button', { name: 'Start exam' });
    expect(start).toHaveClass('vf-btn', 'vf-btn-primary');
    expect(start.closest('.vf-exam-start')).not.toBeNull();
  });

  it('shows attempts used and remaining before starting the compiled exam', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamIntro
          exam={exam.renders.en as never}
          attemptsUsed={1}
          onStart={onStart}
        />
      </Provider>,
    );

    expect(screen.getByRole('heading', { name: 'Module 1 exam' })).toBeInTheDocument();
    expect(screen.getByText('1 of 2 attempts used')).toBeInTheDocument();
    expect(screen.getByText('1 attempt remaining')).toBeInTheDocument();
    expect(screen.getByText('Available anytime')).toBeInTheDocument();
    expect(screen.getByText('Best attempt')).toBeInTheDocument();
    expect(screen.getByText('Fullscreen not required')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Start exam' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it.each([
    ['2026-09-02T09:59:59.000Z', 'This exam is not open yet.', true],
    ['2026-09-02T10:00:00.000Z', 'This exam is open.', false],
    ['2026-09-02T11:00:00.000Z', 'This exam is closed.', true],
  ] as const)('uses authoritative time %s for the start advisory', async (now, status, disabled) => {
    const h = await playerHarness();
    h.exam.settings = {
      ...h.exam.settings,
      openAt: '2026-09-02T10:00:00.000Z',
      closeAt: '2026-09-02T11:00:00.000Z',
    };

    render(
      <Provider>
        <ExamIntro exam={h.exam} attemptsUsed={0} onStart={vi.fn()} now={new Date(now)} />
      </Provider>,
    );

    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start exam' })).toHaveProperty('disabled', disabled);
  });

  it('can omit a duplicate title when the item page owns the heading', () => {
    render(
      <Provider>
        <ExamIntro exam={exam.renders.en as never} attemptsUsed={0} onStart={vi.fn()} hideTitle />
      </Provider>,
    );

    expect(screen.queryByRole('heading', { name: 'Module 1 exam' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start exam' })).toBeInTheDocument();
  });

  it('demotes an authored h1 in the description below the page heading', () => {
    registerAll();
    const description = { blocks: [{ type: 'heading', level: 1, content: [{ text: 'Before you start' }] }, { type: 'paragraph', content: [{ text: 'Read the rules.' }] }] };
    const learnerExam = { ...(exam.renders.en as unknown as LearnerExam), description } as LearnerExam;
    render(
      <Provider>
        <ExamIntro exam={learnerExam} attemptsUsed={0} onStart={vi.fn()} runtime={createPreviewRuntime(exam, 'en')} hideTitle />
      </Provider>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Before you start' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('ExamPlayer', () => {
  it('keeps the legacy route controls in normal page flow', async () => {
    const h = await playerHarness();
    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} />
      </Provider>,
    );

    expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();
    expect(document.querySelector('aside')).not.toHaveClass('fixed');
    expect(screen.getAllByRole('timer')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: h.exam.title }).closest('header'))
      .toContainElement(screen.getByRole('timer'));
  });

  it('places the palette, timer and save state in the frame aside and guards leaving an active attempt', async () => {
    const h = await playerHarness();
    const user = userEvent.setup();
    const { requestNavigation } = await import('@/lib/navigation-guard');
    const view = render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} hideTitle />
      </Provider>,
    );
    const split = view.container.querySelector('.vf-l-split[data-aside]')!;
    expect(split).not.toBeNull();
    // Questions sit flat inside the exam card: cards do not nest.
    const frames = split.querySelectorAll('fieldset[data-question-id]');
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((frame) => expect(frame).not.toHaveClass('rounded-lg', 'bg-card'));
    const aside = split.querySelector(':scope > aside[data-area="aside"]')!;
    expect(split.querySelector(':scope > [data-area="main"]')).not.toBeNull();
    expect(aside).toContainElement(screen.getByRole('timer'));
    expect(aside).toContainElement(screen.getByRole('status'));
    expect(aside.querySelector('#exam-question-palette')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Submit exam' })).toHaveClass('vf-btn', 'vf-btn-primary');
    expect(view.container.querySelector('[class*="bg-secondary"]')).toBeNull();

    let decision = requestNavigation();
    const dialog = await screen.findByRole('dialog', { name: en.exam.player.leaveTitle });
    expect(dialog).toHaveTextContent(en.exam.player.leaveBody);
    await user.click(screen.getByRole('button', { name: en.exam.player.stay }));
    await expect(decision).resolves.toBe(false);
    decision = requestNavigation();
    await user.click(await screen.findByRole('button', { name: en.exam.player.leave }));
    await expect(decision).resolves.toBe(true);
    view.unmount();
    await expect(requestNavigation()).resolves.toBe(true);
  });

  it('returns focus to the link that asked to leave when the learner stays', async () => {
    const h = await playerHarness();
    const user = userEvent.setup();
    const { requestNavigation } = await import('@/lib/navigation-guard');
    // Mirrors LearnerNavigationLink: a cancelled navigation refocuses its source.
    const leave = async (event: React.MouseEvent<HTMLButtonElement>) => {
      const source = event.currentTarget;
      if (!(await requestNavigation()) && source.isConnected) source.focus();
    };
    render(
      <Provider>
        <button type="button" onClick={(event) => void leave(event)}>Back to course</button>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} hideTitle />
      </Provider>,
    );
    const back = screen.getByRole('button', { name: 'Back to course' });
    back.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: en.exam.player.leaveTitle });
    await user.click(screen.getByRole('button', { name: en.exam.player.stay }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(back).toHaveFocus();

    back.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: en.exam.player.leaveTitle });
    await user.keyboard('{Escape}');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(back).toHaveFocus();
  });

  it('offers a compact question disclosure and submit control beside the live save state', async () => {
    const h = await playerHarness();
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} hideTitle />
      </Provider>,
    );

    expect(screen.queryByRole('heading', { name: h.exam.title })).not.toBeInTheDocument();
    const actions = screen.getByRole('group', { name: 'Exam actions' });
    expect(actions).toContainElement(screen.getByRole('status'));
    expect(actions).toHaveTextContent('Time remaining');
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Submit exam' }));
    const toggle = screen.getByRole('button', { name: 'Questions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Question 1: unanswered, not flagged' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Question 1' })).toHaveFocus();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Question 4: unanswered, not flagged' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Part 2: Application' })).toHaveFocus();
  });

  it('hydrates controls from server-accepted answers', async () => {
    const h = await playerHarness();
    h.attempt.answers = { 's1/e1': 'a' };

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    })).toBeChecked();
  });

  it('overlays an exact-attempt pending draft without treating it as server-accepted', async () => {
    const h = await playerHarness();
    h.attempt.answers = { 's1/e1': 'a' };
    createPendingExamDraftStore(h.attempt.attemptId).write({ 's1/e1': 'b' });

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByRole('radio', { name: 'It needs no data' })).toBeChecked();
    expect((await h.repo.listAnswers(h.attempt.attemptId))).toHaveLength(0);
  });

  it('saves only the pending delta so an accepted earlier-section answer is not replayed', async () => {
    const h = await playerHarness();
    await h.client.save({ 's1/e1': 'a' });
    h.attempt.answers = { 's1/e1': 'a' };
    createPendingExamDraftStore(h.attempt.attemptId).write({ 's2/e2': 'Later section answer' });
    const save = vi.spyOn(h.client, 'save');
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} />
      </Provider>,
    );
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ 's2/e2': 'Later section answer' });
  });

  it('renders an explicit error instead of crashing when the learner exam has no sections', async () => {
    const h = await playerHarness();
    h.exam.sections = [];

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This exam has no available sections. Please contact support.',
    );
  });

  it('updates answered and flagged states in the question palette', async () => {
    const h = await playerHarness();
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByRole('button', {
      name: 'Question 1: unanswered, not flagged',
    })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getAllByRole('radio')[0]);
    const answeredPaletteButton = screen.getByRole('button', {
      name: 'Question 1: answered, not flagged',
    });
    expect(answeredPaletteButton).toHaveAttribute('data-answered', 'true');

    await user.click(screen.getByRole('button', { name: 'Flag question 1' }));
    expect(screen.getByRole('button', {
      name: 'Question 1: answered, flagged',
    })).toHaveAttribute('data-flagged', 'true');
    // The toggle's name carries its state; aria-pressed would contradict "Remove flag".
    expect(screen.getByRole('button', { name: 'Remove flag from question 1' })).not.toHaveAttribute('aria-pressed');
  });

  it('keeps sequential palette states focusable while preventing navigation', async () => {
    const h = await playerHarness({ navigation: 'sequential' });
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
          hideTitle
        />
      </Provider>,
    );

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Flag question 1' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    const lockedQuestion = screen.getByRole('button', {
      name: 'Question 1: answered, flagged',
    });
    expect(lockedQuestion).not.toBeDisabled();
    expect(lockedQuestion).toHaveAttribute('aria-disabled', 'true');
    const currentQuestion = screen.getByRole('button', {
      name: 'Question 2: unanswered, not flagged',
    });
    expect(currentQuestion).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Question 2' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Questions' }));
    expect(currentQuestion).toHaveFocus();

    await user.click(lockedQuestion);

    expect(lockedQuestion).toHaveFocus();
    expect(currentQuestion).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Question 2' })).toBeInTheDocument();
  });

  it('focuses the section heading before instructions when navigation changes sections', async () => {
    const h = await playerHarness();
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await user.click(screen.getByRole('button', {
      name: 'Question 4: unanswered, not flagged',
    }));

    expect(screen.getByRole('heading', { name: 'Part 2: Application' })).toHaveFocus();
  });

  it.each([
    ['one_per_page', 1],
    ['section_per_page', 3],
    ['single_page', 6],
  ] as const)('renders the %s layout', async (layout, visibleQuestions) => {
    const h = await playerHarness({ layout });

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(document.querySelectorAll('[data-exam-question]')).toHaveLength(visibleQuestions);
  });

  it('keeps section context visible in the one-question layout', async () => {
    const h = await playerHarness({ layout: 'one_per_page' });
    h.exam.sections[0].instructions = {
      blocks: [{ type: 'paragraph', content: [{ text: 'Read this section carefully.' }] }],
    };

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    expect(screen.getByRole('heading', { name: 'Part 1: Concepts' })).toBeInTheDocument();
    expect(screen.getByText('Read this section carefully.')).toBeInTheDocument();
  });

  it('saves pending changes after one second without resending accepted answers every 30 seconds', async () => {
    const h = await playerHarness();
    const save = vi.spyOn(h.service, 'save');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps a settled draft saved without restarting the one-second flush after status renders', async () => {
    const h = await playerHarness();
    const save = vi.spyOn(h.client, 'save');
    const baseStore = createPendingExamDraftStore(h.attempt.attemptId);
    const write = vi.spyOn(baseStore, 'write');
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} draftStore={baseStore} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(save).toHaveBeenCalledOnce();
    const settledWrites = write.mock.calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(save).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(settledWrites);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('serializes autosaves so an older response cannot overwrite a newer answer', async () => {
    const h = await playerHarness();
    let releaseFirstSave = () => {};
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const snapshots: Record<string, unknown>[] = [];
    const save = vi.fn(async (answers: Record<string, unknown>) => {
      snapshots.push(structuredClone(answers));
      if (snapshots.length === 1) await firstSaveGate;
      return h.client.save(answers);
    });
    const client = { ...h.client, save };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    fireEvent.click(screen.getByRole('radio', { name: 'It needs no data' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(save).toHaveBeenCalledTimes(1);
    releaseFirstSave();
    await act(async () => { await firstSaveGate; });
    await act(async () => Promise.resolve());

    expect(save).toHaveBeenCalledTimes(2);
    expect(snapshots.map((snapshot) => snapshot['s1/e1'])).toEqual(['a', 'b']);
    expect((await h.repo.listAnswers(h.attempt.attemptId))
      .find((answer) => answer.questionId === 's1/e1')?.answer).toBe('b');
  });

  it('keeps the newest pending draft when an older save succeeds, then clears it after the newest save', async () => {
    const h = await playerHarness();
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let call = 0;
    const save = vi.fn(async (answers: Record<string, unknown>) => {
      call += 1;
      await (call === 1 ? firstGate : secondGate);
      return h.client.save(answers);
    });
    const client = { ...h.client, save };
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    fireEvent.click(screen.getByRole('radio', { name: 'It needs no data' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(store.read()).toEqual({ 's1/e1': 'b' });

    releaseFirst();
    await act(async () => firstGate);
    await act(async () => Promise.resolve());
    expect(store.read()).toEqual({ 's1/e1': 'b' });

    releaseSecond();
    await act(async () => secondGate);
    await act(async () => Promise.resolve());
    expect(store.read()).toBeNull();
  });

  it('shows failed and retrying states and manually retries the latest pending snapshot', async () => {
    const h = await playerHarness();
    let releaseRetry = () => {};
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (answers: Record<string, unknown>) => {
        await retryGate;
        return h.client.save(answers);
      });
    const client = { ...h.client, save };
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole('status')).toHaveTextContent('Changes are not saved.');
    expect(store.read()).toEqual({ 's1/e1': 'a' });

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(screen.getByRole('status')).toHaveTextContent('Retrying…');
    releaseRetry();
    await act(async () => retryGate);
    await act(async () => Promise.resolve());
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(store.read()).toBeNull();
  });

  it('retains pending answers after a section deadline rejection without treating the attempt as terminal', async () => {
    const h = await playerHarness();
    const onTerminal = vi.fn();
    const error = Object.assign(new Error('section closed'), { code: 'SECTION_DEADLINE_PASSED' });
    const client = { ...h.client, save: vi.fn().mockRejectedValue(error) };
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(screen.getByRole('status')).toHaveTextContent('Changes are not saved.');
    expect(store.read()).toEqual({ 's1/e1': 'a' });
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('saves valid later-section work and requires confirmation before submitting past a section cutoff', async () => {
    const h = await playerHarness();
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    store.write({ 's1/e1': 'a', 's2/e2': 'Later section answer' });
    const sectionError = Object.assign(new Error('section closed'), { code: 'SECTION_DEADLINE_PASSED' });
    const save = vi.fn(async (answers: Record<string, unknown>) => {
      if (Object.hasOwn(answers, 's1/e1')) throw sectionError;
      return h.client.save(answers);
    });
    const submit = vi.spyOn(h.client, 'submit');
    const onSubmitted = vi.fn();
    const recovery = vi.fn();
    const client = { ...h.client, save, submit };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={onSubmitted} onRecoverySnapshot={recovery} />
      </Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));

    const finish = await screen.findByRole('button', { name: 'Submit saved answers' });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('A section closed before its latest answers could be saved.');
    expect(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' })).toBeDisabled();
    expect((await h.repo.listAnswers(h.attempt.attemptId)).find(({ questionId }) => questionId === 's2/e2')?.answer)
      .toBe('Later section answer');
    expect(store.read()).toEqual({ 's1/e1': 'a' });

    await user.click(finish);
    expect(submit).toHaveBeenCalledOnce();
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(store.read()).toEqual({ 's1/e1': 'a' });
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, verified: false, answers: { 's1/e1': 'a', 's2/e2': 'Later section answer' } }));
  });

  it('preserves unaccepted answers and restores only confirmed server truth after a global deadline rejection', async () => {
    const h = await playerHarness();
    const onTerminal = vi.fn();
    const error = Object.assign(new Error('attempt expired'), { code: 'DEADLINE_PASSED' });
    const recovery = vi.fn();
    const client = { ...h.client, save: vi.fn().mockRejectedValue(error), session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: { ...h.attempt, status: 'expired', answers: {} } }) };
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    vi.useFakeTimers();

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));

    expect(store.read()).toEqual({ 's1/e1': 'a' });
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, verified: true, answers: { 's1/e1': 'a' } }));
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('retains an incomplete-flush recovery candidate across an unknown submission reconciliation', async () => {
    const h = await playerHarness();
    const store = createPendingExamDraftStore(h.attempt.attemptId);
    store.write({ 's1/e1': 'a' });
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('Section closed'), { code: 'SECTION_DEADLINE_PASSED' }));
    const submit = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Outcome unknown'), { code: 'SUBMIT_OUTCOME_UNKNOWN', ambiguous: true })).mockImplementationOnce(() => h.client.submit());
    const recovery = vi.fn();
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={{ ...h.client, save, submit }} runtime={h.runtime} onSubmitted={onSubmitted} onRecoverySnapshot={recovery} /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    await user.click(await screen.findByRole('button', { name: 'Submit saved answers' }));
    const check = await screen.findByRole('button', { name: 'Check submission status' });
    const savedCalls = save.mock.calls.length;
    expect(recovery).not.toHaveBeenCalled();
    await user.click(check);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(savedCalls);
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, verified: false, answers: { 's1/e1': 'a' } }));
    expect(store.read()).toEqual({ 's1/e1': 'a' });
  });

  it('reports when session recovery storage cannot retain a pending answer', async () => {
    const h = await playerHarness();
    const quotaStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    } as unknown as Storage;
    const draftStore = createPendingExamDraftStore(h.attempt.attemptId, quotaStorage);

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} draftStore={draftStore} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));

    expect(screen.getByRole('alert')).toHaveTextContent('This browser cannot keep an offline recovery copy.');
  });

  it('offers an own-answer download and protects unavailable recovery without a second approved document prompt', async () => {
    const h = await playerHarness();
    const store = { key: 'unavailable-recovery', read: () => null, write: vi.fn(() => false), clear: vi.fn() };
    const client = { ...h.client, save: vi.fn().mockRejectedValue(new Error('Offline')) };
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} draftStore={store} onSubmitted={vi.fn()} /></Provider>);
    const cleanExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    expect(await screen.findByRole('button', { name: 'Download local answers — attempt 1' })).toBeInTheDocument();
    const unsafeExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unsafeExit);
    expect(unsafeExit.defaultPrevented).toBe(true);
    const { requestNavigation } = await import('@/lib/navigation-guard');
    const controller = new AbortController();
    let decision!: Promise<boolean>;
    act(() => { decision = requestNavigation({ kind: 'document', signal: controller.signal }); });
    const dialog = await screen.findByRole('dialog', { name: en.exam.player.leaveTitle });
    expect(within(dialog).getByText(en.exam.player.leaveRecoveryUnavailable)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download local answers — attempt 1' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.exam.player.leave }));
    await expect(decision).resolves.toBe(true);
    const approvedExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(approvedExit);
    expect(approvedExit.defaultPrevented).toBe(false);
    controller.abort();
    const laterExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(laterExit);
    expect(laterExit.defaultPrevented).toBe(true);
  });

  it('does not grade stale answers when the final save fails', async () => {
    const h = await playerHarness();
    const submit = vi.spyOn(h.service, 'submit');
    const client = {
      ...h.client,
      save: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    await user.click(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    }));
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The exam could not be submitted. Please try again.',
    );
    const confirmation = screen.getByRole('dialog', { name: 'Submit exam?' });
    expect(within(confirmation).getByRole('alert')).toHaveTextContent('The exam could not be submitted. Please try again.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(confirmation).getByRole('button', { name: 'Retry submission' })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toEqual({ 's1/e1': 'a' });
  });

  it.each(['active', 'different-attempt', 'unavailable'])('retains local answers when a terminal rejection is not confirmed: %s', async (inspection) => {
    const h = await playerHarness();
    const session = inspection === 'unavailable'
      ? vi.fn().mockRejectedValue(new Error('Session unavailable'))
      : vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: inspection === 'different-attempt' ? { ...h.attempt, attemptId: 'new-attempt-B', status: 'graded' } : h.attempt });
    const submit = vi.fn();
    const client = { ...h.client, session, submit, save: vi.fn().mockRejectedValue(Object.assign(new Error('Terminal not confirmed'), { code: 'DEADLINE_PASSED' })) };
    const onTerminal = vi.fn();
    const recovery = vi.fn();
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} /></Provider>);
    const answer = screen.getByRole('radio', { name: 'It creates new content instead of only classifying' });
    await user.click(answer);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    expect(await screen.findByText(en.exam.player.terminalUnconfirmed)).toBeInTheDocument();
    expect(answer).toBeChecked();
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toEqual({ 's1/e1': 'a' });
    expect(session).toHaveBeenCalledWith({ bind: false });
    expect(onTerminal).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('preserves the latest own answer on confirmed expiry when quota prevents updating an older journal', async () => {
    const h = await playerHarness();
    const draftStore = { key: 'own-old-journal', read: () => ({ 's1/e1': 'b' }), write: vi.fn(() => false), clear: vi.fn() };
    const client = { ...h.client, session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: { ...h.attempt, status: 'expired', answers: {} } }), save: vi.fn().mockRejectedValue(Object.assign(new Error('Expired'), { code: 'DEADLINE_PASSED' })) };
    const recovery = vi.fn();
    const onTerminal = vi.fn();
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} draftStore={draftStore} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} /></Provider>);
    await user.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    await waitFor(() => expect(onTerminal).toHaveBeenCalledOnce());
    expect(recovery).toHaveBeenCalledWith({ attemptId: h.attempt.attemptId, attemptNo: h.attempt.attemptNo, answers: { 's1/e1': 'a' }, verified: true, storageUnavailable: true });
    expect(draftStore.clear).not.toHaveBeenCalled();
    expect(draftStore.read()).toEqual({ 's1/e1': 'b' });
  });

  it('does not report exclusion when terminal server answers already contain a lost-acknowledgement response', async () => {
    const h = await playerHarness();
    const client = { ...h.client, session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: { ...h.attempt, status: 'graded', answers: { 's1/e1': 'a' } } }), save: vi.fn().mockRejectedValue(Object.assign(new Error('Already terminal'), { code: 'ATTEMPT_NOT_ACTIVE' })) };
    const recovery = vi.fn();
    const onTerminal = vi.fn();
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} /></Provider>);
    await user.click(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }));
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    await waitFor(() => expect(onTerminal).toHaveBeenCalledOnce());
    expect(recovery).not.toHaveBeenCalled();
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toBeNull();
  });

  it('keeps an oversized answer intact and requires an edit before saving or submitting again', async () => {
    const h = await playerHarness();
    const questionId = h.exam.sections[0].questions[0].id;
    h.exam.sections[0].questions = [{ id: questionId, type: 'essay', points: 1, content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain your reasoning' }] }] } }];
    const save = vi.spyOn(h.client, 'save');
    const submit = vi.spyOn(h.client, 'submit');
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} /></Provider>);
    const answer = screen.getByRole('textbox', { name: 'Explain your reasoning' });
    const oversized = '界'.repeat(23_000);
    fireEvent.change(answer, { target: { value: oversized } });
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    const dialog = screen.getByRole('dialog', { name: 'Submit exam?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('64 KiB');
    expect(within(dialog).getByRole('button', { name: 'Retry submission' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep working' }));
    expect(answer).toHaveValue(oversized);
    expect(screen.getByRole('button', { name: 'Submit exam' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDisabled();
    fireEvent.change(answer, { target: { value: 'Shortened answer' } });
    expect(screen.getByRole('button', { name: 'Submit exam' })).toBeEnabled();
    expect(answer).toHaveValue('Shortened answer');
  });

  it('does not discard or submit an oversized response from the client countdown when the server still reports an active attempt', async () => {
    const h = await playerHarness({ timeLimitMinutes: 1 / 60, lateSubmission: 'accept_flagged' });
    const questionId = h.exam.sections[0].questions[0].id;
    h.exam.sections[0].questions = [{ id: questionId, type: 'essay', points: 1, content: { blocks: [{ type: 'paragraph', content: [{ text: 'Keep this response' }] }] } }];
    const session = vi.spyOn(h.client, 'session');
    const submit = vi.spyOn(h.client, 'submit');
    const recovery = vi.fn();
    const onTerminal = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} /></Provider>);
    const answer = screen.getByRole('textbox', { name: 'Keep this response' });
    const oversized = '界'.repeat(23_000);
    fireEvent.change(answer, { target: { value: oversized } });
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(session).toHaveBeenCalledWith({ bind: false });
    expect(answer).toHaveValue(oversized);
    expect(onTerminal).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(en.exam.player.terminalUnconfirmed)).toBeInTheDocument();
  });

  it('keeps one pending confirmation and blocks dismissal and navigation until submission settles', async () => {
    const h = await playerHarness();
    let rejectSubmit!: (error: Error) => void;
    const submit = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectSubmit = reject; }));
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={{ ...h.client, submit }} runtime={h.runtime} onSubmitted={vi.fn()} /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const dialog = screen.getByRole('dialog', { name: 'Submit exam?' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Keep working' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const { requestNavigation } = await import('@/lib/navigation-guard');
    await expect(requestNavigation()).resolves.toBe(false);
    await act(async () => { rejectSubmit(new Error('Definitive submission failure')); });
    expect(await within(dialog).findByRole('button', { name: 'Retry submission' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Keep working' })).toBeEnabled();
  });

  it('checks an unknown submission without resaving answers and unlocks only after authoritative confirmation', async () => {
    const h = await playerHarness();
    const save = vi.spyOn(h.client, 'save');
    const submit = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Unconfirmed submission'), { code: 'SUBMIT_OUTCOME_UNKNOWN', ambiguous: true }))
      .mockImplementationOnce(() => h.client.submit());
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={{ ...h.client, submit }} runtime={h.runtime} onSubmitted={onSubmitted} /></Provider>);
    const answer = screen.getByRole('radio', { name: 'It creates new content instead of only classifying' });
    await user.click(answer);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    const dialog = screen.getByRole('dialog', { name: 'Submit exam?' });
    const check = await within(dialog).findByRole('button', { name: 'Check submission status' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('has not been confirmed');
    expect(within(dialog).getByRole('button', { name: 'Keep working' })).toBeDisabled();
    expect(answer).toBeChecked();
    expect(answer).toBeDisabled();
    const savedCalls = save.mock.calls.length;
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(check);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(savedCalls);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('flushes a last-second pending answer during grace before automatic submission', async () => {
    const h = await playerHarness({ timeLimitMinutes: 1 / 60, lateSubmission: 'accept_flagged' });
    await h.client.save({ 's1/e1': 'a' });
    h.attempt.answers = { 's1/e1': 'a' };
    createPendingExamDraftStore(h.attempt.attemptId).write({ 's1/e1': 'b' });
    const save = vi.spyOn(h.client, 'save');
    const submit = vi.spyOn(h.client, 'submit');
    const onSubmitted = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={onSubmitted} />
      </Provider>,
    );
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({ 's1/e1': 'b' });
    expect(submit).toHaveBeenCalledOnce();
    expect((await h.repo.listAnswers(h.attempt.attemptId)).find(({ questionId }) => questionId === 's1/e1')?.answer).toBe('b');
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toBeNull();
  });

  it('uses accepted server answers after grace without replaying rejected local changes', async () => {
    const h = await playerHarness({ timeLimitMinutes: 1 / 60, lateSubmission: 'accept_flagged' });
    await h.client.save({ 's1/e1': 'a' });
    h.attempt.answers = { 's1/e1': 'a' };
    createPendingExamDraftStore(h.attempt.attemptId).write({ 's1/e1': 'b' });
    const save = vi.spyOn(h.client, 'save');
    const submit = vi.spyOn(h.client, 'submit');
    const onTerminal = vi.fn(async () => { await h.client.session(); });
    const recovery = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={vi.fn()} onTerminal={onTerminal} onRecoverySnapshot={recovery} />
      </Provider>,
    );
    await act(async () => Promise.resolve());
    h.clock.set('2026-09-02T00:01:00.000Z');
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledOnce());

    expect(save).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'It needs no data' })).toBeDisabled();
    expect((await h.repo.listAnswers(h.attempt.attemptId)).find(({ questionId }) => questionId === 's1/e1')?.answer).toBe('a');
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toEqual({ 's1/e1': 'b' });
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, verified: true, answers: { 's1/e1': 'b' } }));
  });

  it('stops debounced and periodic saves once final submission begins', async () => {
    const h = await playerHarness();
    let releaseSave = () => {};
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const save = vi.fn(async (answers: Record<string, unknown>) => {
      await saveGate;
      return h.client.save(answers);
    });
    const client = { ...h.client, save };
    const onSubmitted = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={onSubmitted}
        />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    const confirm = screen.getByRole('button', { name: 'Submit now' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    await act(async () => Promise.resolve());
    expect(save).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    releaseSave();
    await act(async () => { await saveGate; });
    await act(async () => Promise.resolve());

    expect(save).toHaveBeenCalledOnce();
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('settles the save status after a successful submission', async () => {
    const h = await playerHarness();
    const onSubmitted = vi.fn(() => new Promise<void>(() => {}));
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={onSubmitted}
        />
      </Provider>,
    );
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('status')).not.toHaveTextContent('Saving…');
    expect(screen.queryByRole('dialog', { name: 'Submit exam?' })).not.toBeInTheDocument();
    expect(screen.getByText(en.exam.flow.loadingReview)).toBeInTheDocument();
  });

  it('retries only review loading after an acknowledged submission callback fails', async () => {
    const h = await playerHarness();
    const submit = vi.spyOn(h.client, 'submit');
    const onSubmitted = vi.fn().mockRejectedValueOnce(new Error('Review unavailable')).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<Provider><ExamPlayer exam={h.exam} attempt={h.attempt} client={h.client} runtime={h.runtime} onSubmitted={onSubmitted} /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    const retry = await screen.findByRole('button', { name: en.exam.flow.retryReview });
    expect(screen.getByRole('alert')).toHaveTextContent(en.exam.flow.reviewError);
    expect(screen.queryByText(en.exam.player.submitError)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Submit exam?' })).not.toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('announces timer warnings and auto-submits exactly once at zero', async () => {
    const h = await playerHarness({
      timeLimitMinutes: 5 + (1 / 60),
      lateSubmission: 'accept_flagged',
    });
    const submit = vi.spyOn(h.service, 'submit');
    const onSubmitted = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={onSubmitted}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());

    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('05:01');
    expect(timer).not.toHaveAttribute('aria-live');
    expect(timer).not.toHaveAttribute('aria-atomic');
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('Five minutes remaining.')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Five minutes remaining.')).toHaveAttribute('aria-atomic', 'true');

    await act(async () => vi.advanceTimersByTimeAsync(240_000));
    expect(screen.getByText('One minute remaining.')).toHaveAttribute('aria-live', 'polite');

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(screen.getByText('Time is up. Your exam is being submitted.')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('derives the countdown from the server clock instead of the device clock', async () => {
    const h = await playerHarness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:05:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());

    expect(screen.getByRole('timer')).toHaveTextContent('30:00');
  });

  it('uses the request round-trip midpoint when synchronizing the server clock', async () => {
    const h = await playerHarness();
    const client = {
      ...h.client,
      serverNow: vi.fn(async () => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
        return h.client.serverNow();
      }),
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:05:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.getByRole('timer')).toHaveTextContent('29:59');
  });

  it('resynchronizes the server clock every sixty seconds', async () => {
    const h = await playerHarness();
    const serverNow = vi.spyOn(h.client, 'serverNow');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());
    expect(serverNow).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(serverNow).toHaveBeenCalledTimes(2);
  });

  it('expires from monotonic elapsed time when the device clock moves backwards', async () => {
    const h = await playerHarness({
      timeLimitMinutes: 2 / 60,
      lateSubmission: 'accept_flagged',
    });
    const submit = vi.spyOn(h.service, 'submit');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());

    vi.setSystemTime(new Date('2026-09-01T23:00:00.000Z'));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(submit).toHaveBeenCalledOnce();
  });

  it('keeps the deadline authoritative when server clock synchronization fails', async () => {
    const h = await playerHarness({
      timeLimitMinutes: 2 / 60,
      lateSubmission: 'accept_flagged',
    });
    const submit = vi.spyOn(h.service, 'submit');
    const client = {
      ...h.client,
      serverNow: vi.fn().mockRejectedValue(new Error('clock unavailable')),
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());
    expect(screen.getByRole('timer')).toHaveTextContent('00:02');

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('bounds clock synchronization so a hung request cannot stop expiry', async () => {
    const h = await playerHarness({
      timeLimitMinutes: 6 / 60,
      lateSubmission: 'accept_flagged',
    });
    const submit = vi.spyOn(h.service, 'submit');
    const client = {
      ...h.client,
      serverNow: vi.fn(() => new Promise<Date>(() => {})),
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:06');

    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('requests fullscreen and posts integrity events in ten-second batches', async () => {
    const h = await playerHarness({
      integrity: { logFocusLoss: true, logPaste: true, requireFullscreen: true },
    });
    const events = vi.spyOn(h.service, 'events');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    await act(async () => Promise.resolve());
    expect(requestFullscreen).toHaveBeenCalledOnce();

    fireEvent.blur(window);
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.paste(screen.getByRole('article'), {
      clipboardData: { getData: () => 'do not log this content' },
    });
    fireEvent(document, new Event('fullscreenchange'));

    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(events).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(events).toHaveBeenCalledOnce();
    expect(events.mock.calls[0]?.[2].map((event) => event.type)).toEqual([
      'focus_lost',
      'focus_gained',
      'visibility_hidden',
      'paste',
      'fullscreen_exit',
    ]);
    expect(events.mock.calls[0]?.[2][3]?.meta).toEqual({ characterCount: 23 });
    visibility.mockRestore();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it('offers a keyboard-operable fullscreen retry when automatic entry is rejected', async () => {
    const h = await playerHarness({
      integrity: { logFocusLoss: true, logPaste: true, requireFullscreen: true },
    });
    const requestFullscreen = vi.fn()
      .mockRejectedValueOnce(new Error('user activation required'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );

    const retry = await screen.findByRole('button', { name: 'Enter fullscreen' });
    await user.click(retry);
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it('does not collect integrity signals disabled by the exam settings', async () => {
    const h = await playerHarness({
      integrity: { logFocusLoss: false, logPaste: false, requireFullscreen: false },
    });
    const events = vi.spyOn(h.service, 'events');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.blur(window);
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.paste(screen.getByRole('article'), {
      clipboardData: { getData: () => 'private answer' },
    });

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(events).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it.each(['ATTEMPT_NOT_ACTIVE', 'FORBIDDEN'])('drops an integrity batch after a non-retryable %s error', async (code) => {
    const h = await playerHarness();
    const terminalError = Object.assign(new Error('attempt closed'), {
      code,
    });
    const events = vi.fn()
      .mockRejectedValueOnce(terminalError)
      .mockResolvedValue({ accepted: 1, dropped: 0 });
    const client = { ...h.client, events };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.blur(window);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    fireEvent.focus(window);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));

    expect(events).toHaveBeenCalledTimes(2);
    expect(events.mock.calls[1]?.[0].map((event: { type: string }) => event.type)).toEqual([
      'focus_gained',
    ]);
  });

  it('stops integrity collection, flushing, and cleanup posts once submission begins', async () => {
    const h = await playerHarness();
    const save = vi.fn(() => new Promise<never>(() => {}));
    const events = vi.fn().mockResolvedValue({ accepted: 0, dropped: 0 });
    const client = { ...h.client, save, events };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    const { unmount } = render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit now' }));
    await act(async () => Promise.resolve());
    expect(save).toHaveBeenCalledOnce();

    fireEvent.blur(window);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(events).not.toHaveBeenCalled();

    unmount();
    await act(async () => Promise.resolve());
    expect(events).not.toHaveBeenCalled();
  });

  it('flushes the final integrity batch before submitting the attempt', async () => {
    const h = await playerHarness();
    const events = vi.spyOn(h.service, 'events');
    const submit = vi.spyOn(h.service, 'submit');
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.blur(window);
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));

    expect(events).toHaveBeenCalledOnce();
    expect(events.mock.calls[0]?.[2].map((event) => event.type)).toEqual(['focus_lost']);
    expect(events.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]);
  });

  it('bounds the wait for an in-flight integrity batch before submission', async () => {
    const h = await playerHarness();
    const submit = vi.spyOn(h.service, 'submit');
    const client = {
      ...h.client,
      events: vi.fn(() => new Promise<{ accepted: number; dropped: number }>(() => {})),
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.blur(window);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(client.events).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Submit exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit now' }));
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(submit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('confirms the unanswered count in a focus-contained submit dialog', async () => {
    const h = await playerHarness();
    const submit = vi.spyOn(h.service, 'submit');
    const onSubmitted = vi.fn();
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={onSubmitted}
        />
      </Provider>,
    );

    const trigger = screen.getByRole('button', { name: 'Submit exam' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Submit exam?' });
    expect(dialog).toHaveTextContent('6 questions are unanswered.');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.querySelector('article')).toContainElement(dialog);

    await user.click(screen.getByRole('button', { name: 'Keep working' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('uses the Vietnamese zero branch when every visible question is answered', async () => {
    const h = await playerHarness();
    h.exam.sections = [{
      ...h.exam.sections[0],
      questions: [h.exam.sections[0].questions[0]],
    }];
    const user = userEvent.setup();

    render(
      <VietnameseProvider>
        <ExamPlayer
          exam={h.exam}
          attempt={h.attempt}
          client={h.client}
          runtime={h.runtime}
          onSubmitted={vi.fn()}
        />
      </VietnameseProvider>,
    );

    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Nộp bài' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Tất cả câu hỏi đều đã được trả lời.',
    );
  });
});

describe('ExamReview', () => {
  it('can omit its title when the item page provides the result heading', async () => {
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{ attemptId: h.attempt.attemptId, status: 'pending_manual', late: false, released: false, answers: {}, revealed: {} }}
          runtime={h.runtime}
          hideTitle
        />
      </Provider>,
    );

    expect(screen.queryByRole('heading', { name: 'Exam review' })).not.toBeInTheDocument();
    expect(screen.getByText('Awaiting grading')).toBeInTheDocument();
  });

  it('renders its questions flat inside the review card', async () => {
    const h = await playerHarness();
    const view = render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{ attemptId: h.attempt.attemptId, status: 'pending_manual', late: false, released: false, answers: {}, revealed: {} }}
          runtime={h.runtime}
          hideTitle
        />
      </Provider>,
    );
    const frames = view.container.querySelectorAll('fieldset[data-question-id]');
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((frame) => expect(frame).not.toHaveClass('rounded-lg', 'bg-card'));
  });

  it('shows only released manual feedback for questions in the restored learner projection', async () => {
    const h = await playerHarness();
    const baseReview = {
      attemptId: h.attempt.attemptId,
      status: 'graded' as const,
      late: false,
      answers: {},
      revealed: {},
      manualFeedback: { 's1/e1': 'Strong explanation.', 'unknown/question': 'Do not render.' },
    };
    const { rerender } = render(
      <Provider>
        <ExamReview exam={h.exam} review={{ ...baseReview, released: false }} runtime={h.runtime} />
      </Provider>,
    );
    expect(screen.queryByText('Strong explanation.')).not.toBeInTheDocument();

    rerender(
      <Provider>
        <ExamReview exam={h.exam} review={{ ...baseReview, released: true }} runtime={h.runtime} />
      </Provider>,
    );
    expect(screen.getByRole('heading', { name: 'Instructor feedback' })).toBeInTheDocument();
    expect(screen.getByText('Feedback for question 1')).toBeInTheDocument();
    expect(screen.getByText('Strong explanation.')).toBeInTheDocument();
    // Instructor feedback reads as a mentor quote (DESIGN signature component).
    expect(screen.getByText('Strong explanation.').closest('figure')).toHaveClass('vf-mentor');
    expect(screen.queryByText('Do not render.')).not.toBeInTheDocument();
  });

  it.each([
    ['pending_manual', false, 'Awaiting grading'],
    ['graded', false, 'Grading complete. Results are awaiting release.'],
    ['graded', true, 'Results released'],
    ['expired', false, 'Attempt expired'],
  ] as const)('describes %s lifecycle truth distinctly', async (status, released, message) => {
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{ attemptId: h.attempt.attemptId, status, late: false, released, answers: {}, revealed: {} }}
          runtime={h.runtime}
        />
      </Provider>,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('renders the awaiting-grading lifecycle in Vietnamese', async () => {
    const h = await playerHarness();
    render(
      <VietnameseProvider>
        <ExamReview
          exam={h.exam}
          review={{ attemptId: h.attempt.attemptId, status: 'pending_manual', late: false, released: false, answers: {}, revealed: {} }}
          runtime={h.runtime}
        />
      </VietnameseProvider>,
    );

    expect(screen.getByText('Đang chờ chấm điểm')).toBeInTheDocument();
  });

  it('shows instructor feedback and a distinct label as soon as results are available', async () => {
    // Completion makes the score and manual feedback the learner's; the answer key is a separate
    // publication, so feedback must not wait for it.
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{
            attemptId: h.attempt.attemptId, status: 'graded', late: false, released: false,
            resultsAvailable: true, answers: {}, revealed: {},
            score: { points: 3, maxPoints: 5, percent: 60 },
            manualFeedback: { 's1/e1': 'Clear reasoning' },
          } as never}
          runtime={h.runtime}
        />
      </Provider>,
    );

    expect(screen.getByText('Score: 3 of 5 (60%)')).toBeInTheDocument();
    expect(screen.getByText('Some review details are not released yet.')).toBeInTheDocument();
    expect(screen.getByText('Clear reasoning')).toBeInTheDocument();
  });

  it('keeps a historical graded attempt awaiting release with no score or feedback', async () => {
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{
            attemptId: h.attempt.attemptId, status: 'graded', late: false, released: false,
            resultsAvailable: false, answers: {}, revealed: {},
            manualFeedback: { 's1/e1': 'Withheld feedback' },
          } as never}
          runtime={h.runtime}
        />
      </Provider>,
    );

    expect(screen.getByText('Your score is not available yet.')).toBeInTheDocument();
    expect(screen.getByText('Grading complete. Results are awaiting release.')).toBeInTheDocument();
    expect(screen.queryByText('Withheld feedback')).not.toBeInTheDocument();
  });

  it('does not tell a learner a visible legacy score is awaiting release', async () => {
    // A historical attempt released the legacy way has no availability marker, so the DTO flag is
    // false while the score is on screen. The label must follow the score the page renders.
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{
            attemptId: h.attempt.attemptId, status: 'graded', late: false, released: false,
            resultsAvailable: false, answers: {}, revealed: {},
            score: { points: 4, maxPoints: 5, percent: 80 },
          } as never}
          runtime={h.runtime}
        />
      </Provider>,
    );

    expect(screen.getByText('Score: 4 of 5 (80%)')).toBeInTheDocument();
    expect(screen.getByText('Some review details are not released yet.')).toBeInTheDocument();
    expect(screen.queryByText('Grading complete. Results are awaiting release.')).not.toBeInTheDocument();
  });

  it('labels a released attempt as released once the answer key is published', async () => {
    const h = await playerHarness();
    render(
      <Provider>
        <ExamReview
          exam={h.exam}
          review={{
            attemptId: h.attempt.attemptId, status: 'graded', late: false, released: true,
            resultsAvailable: true, answers: {}, revealed: {},
            score: { points: 5, maxPoints: 5, percent: 100 },
          } as never}
          runtime={h.runtime}
        />
      </Provider>,
    );

    expect(screen.getByText('Results released')).toBeInTheDocument();
  });

  it('shows an automatically graded score while still withholding the answer key', async () => {
    // Result availability and answer-key release are independent: completing grading — here
    // automatically, on submit — gives the learner the score even though `showScore` is
    // `on_release`, while `showCorrectAnswers`/`showExplanations` stay governed by release.
    const h = await playerHarness({
      review: {
        showScore: 'on_release',
        showCorrectAnswers: 'on_release',
        showExplanations: 'on_release',
        releaseAt: null,
      },
    });
    await h.client.save({ 's1/e1': 'a' });
    await h.client.submit();
    const review = await h.client.review();

    expect(review).not.toHaveProperty('results');
    expect(review.released).toBe(false);
    render(
      <Provider>
        <ExamReview exam={h.exam} review={review} runtime={h.runtime} />
      </Provider>,
    );

    expect(screen.queryByText('Your score is not available yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Some review details are not released yet.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'It creates new content instead of only classifying' }))
      .not.toHaveAttribute('data-correct');
  });

  it('renders correct answers and explanations only when the review DTO reveals them', async () => {
    const h = await playerHarness();
    await h.client.save({ 's1/e1': 'a' });
    await h.client.submit();
    const beforeRelease = await h.client.review();

    const { rerender } = render(
      <Provider>
        <ExamReview exam={h.exam} review={beforeRelease} runtime={h.runtime} />
      </Provider>,
    );

    expect(screen.getByText(/^Score:/)).toBeInTheDocument();
    expect(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    })).not.toHaveAttribute('data-correct', 'true');
    expect(screen.queryByText('Generative models produce text, images or code.')).not.toBeInTheDocument();

    await h.service.release(instructor, { attemptId: h.attempt.attemptId });
    const released = await h.client.review();
    rerender(
      <Provider>
        <ExamReview exam={h.exam} review={released} runtime={h.runtime} />
      </Provider>,
    );

    expect(screen.getByRole('radio', {
      name: 'It creates new content instead of only classifying',
    })).toHaveAttribute('data-correct', 'true');
    expect(screen.getByText('Generative models produce text, images or code.')).toBeInTheDocument();
  });
});

describe('ExamFlow', () => {
  it('threads title suppression into a restored active attempt', async () => {
    const h = await playerHarness();
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: h.attempt }),
    };

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={1} client={client} runtime={h.runtime} hideTitle />
      </Provider>,
    );

    expect(await screen.findByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: h.exam.title })).not.toBeInTheDocument();
  });

  it('hides the activity pager while a restored attempt is active', async () => {
    const h = await playerHarness();
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: h.attempt }),
    };
    const { ActivityProgressProvider, useActivityLocked } = await import('@/features/workspace-ui/learner/activity/ActivityProgress');
    function PagerProbe() { return useActivityLocked() ? null : <p>pager visible</p>; }

    render(
      <Provider>
        <ActivityProgressProvider initial={{ completed: 0, total: 1 }}>
          <PagerProbe />
          <ExamFlow exam={h.exam} attemptsUsed={1} client={client} runtime={h.runtime} hideTitle />
        </ActivityProgressProvider>
      </Provider>,
    );

    expect(screen.getByText('pager visible')).toBeInTheDocument();
    expect(await screen.findByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();
    expect(screen.queryByText('pager visible')).not.toBeInTheDocument();
  });

  it('restores an active final attempt before offering a new start', async () => {
    const h = await playerHarness({ attemptsAllowed: 1 });
    const start = vi.fn();
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: h.attempt }),
      start,
    };

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={1} client={client} runtime={h.runtime} />
      </Provider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your exam…');
    expect(await screen.findByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('restores the latest terminal attempt and clears an already accepted journal without creating another attempt', async () => {
    const h = await playerHarness();
    const terminal = { ...h.attempt, status: 'pending_manual' as const, answers: { 's1/e1': 'a' } };
    const start = vi.fn();
    const draftStore = createPendingExamDraftStore(terminal.attemptId);
    draftStore.write({ 's1/e1': 'a' });
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: terminal }),
      start,
      review: vi.fn().mockResolvedValue({
        attemptId: terminal.attemptId,
        status: 'pending_manual' as const,
        late: false,
        released: false,
        answers: terminal.answers,
        revealed: {},
      }),
    };

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );

    expect(await screen.findByText('Awaiting grading')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(draftStore.read()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download local answers — attempt 1' })).not.toBeInTheDocument();
  });

  it('retries review loading for a restored submitted attempt', async () => {
    const h = await playerHarness();
    const terminal = { ...h.attempt, status: 'graded' as const };
    const review = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        attemptId: terminal.attemptId, status: 'graded' as const, late: false, released: false, answers: {}, revealed: {},
      });
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: terminal }),
      review,
    };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Your exam was submitted, but the review could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Retry review' }));
    expect(await screen.findByText('Grading complete. Results are awaiting release.')).toBeInTheDocument();
    expect(review).toHaveBeenCalledTimes(2);
  });

  it('keeps restore failure retryable without exposing a false Start action', async () => {
    const h = await playerHarness();
    const session = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ attemptsUsed: 0, attempt: null });
    const client = { ...h.client, session };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Your exam session could not be restored.');
    expect(screen.queryByRole('button', { name: 'Start exam' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Start exam' })).toBeEnabled();
  });

  it('starts a next attempt only from an eligible terminal review', async () => {
    const h = await playerHarness({ attemptsAllowed: 2 });
    const terminal = { ...h.attempt, status: 'graded' as const };
    const next = { ...h.attempt, attemptId: 'attempt-next', attemptNo: 2 };
    const start = vi.fn().mockResolvedValue(next);
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: terminal }),
      start,
      review: vi.fn().mockResolvedValue({
        attemptId: terminal.attemptId, status: 'graded' as const, late: false, released: true, answers: {}, revealed: {},
      }),
    };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Start next attempt' }));

    expect(start).toHaveBeenCalledOnce();
    expect(await screen.findByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();
  });

  it('keeps terminal recovery alongside review and never applies it to a new attempt', async () => {
    const h = await playerHarness({ attemptsAllowed: 2 });
    createPendingExamDraftStore(h.attempt.attemptId).write({ 's1/e1': 'Unaccepted own response' });
    const terminal = { ...h.attempt, status: 'graded', answers: {} };
    const next = { ...h.attempt, attemptId: 'next-attempt', attemptNo: 2, answers: {} };
    const client = { ...h.client, session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: terminal }), start: vi.fn().mockResolvedValue(next), review: vi.fn().mockResolvedValue({ attemptId: h.attempt.attemptId, status: 'graded', late: false, released: false, answers: {}, revealed: {} }) };
    const user = userEvent.setup();
    render(<Provider><ExamFlow exam={h.exam} attemptsUsed={1} client={client} runtime={h.runtime} /></Provider>);
    expect(await screen.findByRole('button', { name: 'Download local answers — attempt 1' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Start next attempt' }));
    await screen.findByRole('button', { name: 'Submit exam' });
    for (const answer of screen.getAllByRole('radio')) expect(answer).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Download local answers — attempt 1' })).toBeInTheDocument();
    expect(createPendingExamDraftStore('next-attempt').read()).toBeNull();
    expect(createPendingExamDraftStore(h.attempt.attemptId).read()).toEqual({ 's1/e1': 'Unaccepted own response' });
  });

  it('reports an authoritative active restore once per attempt without starting another attempt', async () => {
    const h = await playerHarness();
    const confirmed = vi.fn();
    const session = vi.spyOn(h.client, 'session');
    const start = vi.spyOn(h.client, 'start');
    const view = render(<Provider><ExamFlow exam={h.exam} attemptsUsed={0} client={h.client} runtime={h.runtime} onConfirmedActive={confirmed} /></Provider>);
    await screen.findByRole('button', { name: 'Submit exam' });
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, status: 'in_progress' }));
    view.rerender(<Provider><ExamFlow exam={h.exam} attemptsUsed={0} client={{ ...h.client }} runtime={h.runtime} onConfirmedActive={confirmed} /></Provider>);
    await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Submit exam' });
    expect(confirmed).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('reports an active start only after the server confirms the attempt', async () => {
    const h = await playerHarness();
    const confirmed = vi.fn();
    const client = { ...h.client, session: vi.fn().mockResolvedValue({ attemptsUsed: 0, attempt: null }), start: vi.fn().mockResolvedValue(h.attempt) };
    const user = userEvent.setup();
    render(<Provider><ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} onConfirmedActive={confirmed} /></Provider>);
    const start = await screen.findByRole('button', { name: 'Start exam' });
    expect(confirmed).not.toHaveBeenCalled();
    await user.click(start);
    await screen.findByRole('button', { name: 'Submit exam' });
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, status: 'in_progress' }));
  });

  it('refreshes availability after a resumed attempt is submitted and reports its confirmed review once', async () => {
    const h = await playerHarness({ attemptsAllowed: 2, openAt: '2026-09-01T00:00:00.000Z', closeAt: '2026-09-03T00:00:00.000Z' });
    const confirmed = vi.fn();
    const serverNow = vi.spyOn(h.client, 'serverNow');
    const user = userEvent.setup();
    render(<Provider><ExamFlow exam={h.exam} attemptsUsed={1} client={h.client} runtime={h.runtime} onConfirmedTerminal={confirmed} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));
    expect(await screen.findByRole('button', { name: 'Start next attempt' })).toBeEnabled();
    expect(serverNow).toHaveBeenCalled();
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ attemptId: h.attempt.attemptId, status: 'graded' }));
  });

  it('does not offer another attempt after terminal review at the attempt limit', async () => {
    const h = await playerHarness({ attemptsAllowed: 1 });
    const terminal = { ...h.attempt, status: 'graded' as const };
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 1, attempt: terminal }),
      review: vi.fn().mockResolvedValue({
        attemptId: terminal.attemptId, status: 'graded' as const, late: false, released: true, answers: {}, revealed: {},
      }),
    };

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );

    expect(await screen.findByText('Results released')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start next attempt' })).not.toBeInTheDocument();
  });

  it('guards duplicate start requests synchronously', async () => {
    const h = await playerHarness();
    const pendingStart = new Promise<never>(() => {});
    const start = vi.fn(() => pendingStart);
    const client = { ...h.client, session: vi.fn().mockResolvedValue({ attemptsUsed: 0, attempt: null }), start };

    render(
      <Provider>
        <ExamFlow exam={h.exam} attemptsUsed={0} client={client} runtime={h.runtime} />
      </Provider>,
    );
    const button = await screen.findByRole('button', { name: 'Start exam' });
    act(() => {
      button.click();
      button.click();
    });

    expect(start).toHaveBeenCalledOnce();
  });

  it('rejects malformed learner sections returned by the start boundary', async () => {
    const h = await playerHarness();
    const client = {
      ...h.client,
      session: vi.fn().mockResolvedValue({ attemptsUsed: 0, attempt: null }),
      start: vi.fn().mockResolvedValue({
        ...h.attempt,
        learner: { sections: [{ id: 'broken-section', title: 'Broken' }] },
      }),
    };
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamFlow
          exam={h.exam}
          attemptsUsed={0}
          client={client}
          runtime={h.runtime}
        />
      </Provider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Start exam' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The exam could not be started. Please try again.',
    );
  });

  it('moves from intro to the started player and then to the filtered review', async () => {
    const item = withExamSettings(exam, { shuffleQuestions: false, shuffleOptions: false });
    const repo = new InMemoryExamRepo();
    const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
    const service = createExamService({
      repo,
      clock,
      track: async () => {},
      bank: bankSource,
      loadItem: async () => itemContext(item),
      isEnrolled: async () => true,
    });
    const client = createMemoryExamClient(
      service,
      learner,
      { courseId: 'ai-foundations', itemId: item.id },
      clock,
    );
    const user = userEvent.setup();

    render(
      <Provider>
        <ExamFlow
          exam={item.renders.en as LearnerExam}
          attemptsUsed={0}
          client={client}
          runtime={createPreviewRuntime(item, 'en')}
        />
      </Provider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Start exam' }));
    expect(await screen.findByRole('navigation', { name: 'Question palette' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    await user.click(screen.getByRole('button', { name: 'Submit now' }));

    expect(await screen.findByRole('heading', { name: 'Exam review' })).toBeInTheDocument();
    expect(screen.getByText(/^Score:/)).toBeInTheDocument();
  });
});

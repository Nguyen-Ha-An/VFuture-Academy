import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@uiw/react-codemirror', () => ({ default: () => <textarea aria-label="code" /> }));
import { registerAll } from '@/content-engine/render';
import { LessonRenderer } from '@/content-engine/render/LessonRenderer';
import { AssignmentBlockRenderer, AssignmentRenderer } from '@/content-engine/render/AssignmentRenderer';
import { ExamPreviewRenderer } from '@/content-engine/render/ExamPreviewRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import { compileCourse, type CompiledItem } from '@/content-engine/compile';
import { InMemoryResolver } from '@/content-engine/validate';
import { seededShuffle } from '@/content-engine/render/shuffle';

beforeAll(() => registerAll());
const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const sc = (id: string, text: string) => ({ id, type: 'single_choice', content: rc(text), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a', explanation: rc(`why ${id}`) });
const manifest = { schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 's', languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' }, modules: [{ id: 'm', title: 'M', items: [{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }, { type: 'assignment', id: 'a1', title: 'Ship', instructions: rc('Build it'), submission: { accepts: ['link', 'text'] }, rubric: { criteria: [{ id: 'c', name: 'Works', maxPoints: 5 }] } }] }] };
const items = {
  l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ id: 'qz', type: 'quiz', title: 'Check', questions: [sc('q1', 'One?'), sc('q2', 'Two?')], settings: { mode: 'graded', attemptsAllowed: 2, passPercent: 100 } }, { id: 'pq', type: 'quiz', questions: [sc('p1', 'Practice?')], settings: { mode: 'practice' } }] },
  e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'Exam', settings: { timeLimitMinutes: 20 }, sections: [{ id: 's1', title: 'Part 1', questions: [sc('x1', 'X?'), { $pool: { id: 'p', count: 2, filter: { tags: ['t'] } } }] }] },
};
const resolver = new InMemoryResolver({ bank: [{ id: 'b1', versionId: 'v', question: sc('b1', 'B1'), tags: ['t'], type: 'single_choice' }, { id: 'b2', versionId: 'v', question: sc('b2', 'B2'), tags: ['t'], type: 'single_choice' }] });

describe('seededShuffle', () => {
  it('is deterministic and a permutation', () => { const a = seededShuffle([1, 2, 3, 4, 5], 'seed'); expect(a).toEqual(seededShuffle([1, 2, 3, 4, 5], 'seed')); expect([...a].sort()).toEqual([1, 2, 3, 4, 5]); });
});

describe('QuizRenderer', () => {
  it('graded quiz: submit, feedback after submit, retry within attempts, completion state', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    const quiz = screen.getByRole('region', { name: 'Check' });
    expect(quiz).toHaveTextContent(/2 questions/i);
    await userEvent.click(screen.getAllByRole('radio', { name: 'B' })[0]);
    await userEvent.click(screen.getAllByRole('radio', { name: 'A' })[1]);
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText('why q1')).toBeInTheDocument();
    expect(screen.getByText(/1 attempt left/i)).toBeInTheDocument();
    expect(rt.getBlockState<{ completed?: boolean }>('qz')?.completed).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.queryByText('why q1')).toBeNull();
  });
  it('deduplicates check requests before React commits the busy state', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    const check = vi.spyOn(rt, 'checkQuestion').mockImplementation(() => new Promise(() => {}));
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    await userEvent.click(screen.getAllByRole('radio', { name: 'A' })[2]);
    const button = screen.getByRole('button', { name: /check answer/i });
    act(() => { button.click(); button.click(); });
    expect(check).toHaveBeenCalledOnce();
  });

  it('keeps answers and unlocks submit after a non-Error rejection', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    vi.spyOn(rt, 'submitQuiz').mockRejectedValueOnce(null);
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    const answer = screen.getAllByRole('radio', { name: 'A' })[0];
    await userEvent.click(answer);
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not submit your quiz/i);
    expect(answer).toBeChecked();
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
  });

  it('does not persist a late check response after unmount', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    let resolve!: (value: Awaited<ReturnType<typeof rt.checkQuestion>>) => void;
    vi.spyOn(rt, 'checkQuestion').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const persist = vi.spyOn(rt, 'setBlockState');
    const view = render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    await userEvent.click(screen.getAllByRole('radio', { name: 'A' })[2]);
    await userEvent.click(screen.getByRole('button', { name: /check answer/i }));
    view.unmount();
    persist.mockClear();
    await act(async () => { resolve({ questionId: 'p1', status: 'correct', points: 1, maxPoints: 1, revealed: {} }); });
    expect(persist).not.toHaveBeenCalled();
  });

  it('practice quiz: check per question', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    await userEvent.click(screen.getAllByRole('radio', { name: 'A' })[2]);
    await userEvent.click(screen.getByRole('button', { name: /check answer/i }));
    expect(await screen.findByText(/^correct/i, { selector: '[data-tone]' })).toBeInTheDocument();
    expect(screen.getByText('why p1')).toBeInTheDocument();
  });
  it('keeps the selected answer and provides a retry when per-question checking fails', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1; const rt = createPreviewRuntime(item, 'en');
    const check = vi.spyOn(rt, 'checkQuestion').mockRejectedValueOnce(new Error('offline'));
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);

    const answer = screen.getAllByRole('radio', { name: 'A' })[2];
    await userEvent.click(answer);
    await userEvent.click(screen.getByRole('button', { name: /check answer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not check this answer/i);
    expect(answer).toBeChecked();
    expect(Object.values(rt.getBlockState<{ answers: Record<string, unknown> }>('pq')?.answers ?? {})).toContain('a');
    await userEvent.click(screen.getByRole('button', { name: /try checking again/i }));
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe('QuizRenderer meta line', () => {
  const lessonWith = (quiz: Record<string, unknown>) => ({ id: 'lq', kind: 'lesson', checksum: '', renders: { en: { kind: 'lesson', id: 'lq', title: 'L', blocks: [quiz] }, vi: { kind: 'lesson', id: 'lq', title: 'L', blocks: [quiz] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }) as never as CompiledItem;
  const meta = (quiz: Record<string, unknown>, locale: 'en' | 'vi' = 'en') => {
    const item = lessonWith({ id: 'qm', type: 'quiz', title: 'Meta', ...quiz });
    render(<LessonRenderer item={item.renders[locale]} runtime={createPreviewRuntime(item, locale)} />);
    return screen.getByRole('region', { name: 'Meta' }).querySelector('header p')?.textContent;
  };

  it('uses a real plural for the question count', () => {
    expect(meta({ questions: [sc('m1', 'One?')] })).toBe('1 question');
    cleanup();
    expect(meta({ questions: [sc('m1', 'One?'), sc('m2', 'Two?')] })).toBe('2 questions');
    cleanup();
    expect(meta({ questions: [sc('m1', 'One?')] }, 'vi')).toBe('1 câu hỏi');
  });

  it('shows the pass mark only when it is above 0%', () => {
    expect(meta({ questions: [sc('m1', 'One?')], settings: { mode: 'graded', passPercent: 0 } })).toBe('1 question · graded');
    cleanup();
    expect(meta({ questions: [sc('m1', 'One?')], settings: { mode: 'practice' } })).toBe('1 question');
    cleanup();
    expect(meta({ questions: [sc('m1', 'One?'), sc('m2', 'Two?')], settings: { mode: 'graded', passPercent: 70 } })).toBe('2 questions · graded · pass ≥ 70%');
  });
});

describe('AssignmentRenderer', () => {
  it('gives notebook assignments the same brief and grading hierarchy', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    rt.notebookHref = () => '/app/notebooks/session';
    const notebookAssignment = {
      ...item.renders.en,
      notebook: { runtimeMode: 'colab_external' },
    } as never;

    render(<AssignmentRenderer assignment={notebookAssignment} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByRole('heading', { name: 'Instructions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grading criteria' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notebook workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open notebook' })).toHaveAttribute('href', '/app/notebooks/session');
    expect(screen.queryByRole('button', { name: 'Submit assignment' })).toBeNull();
  });

  it('groups the brief and submission without repeating a standalone page title', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} hideTitle />);

    expect(screen.queryByRole('heading', { name: 'Ship' })).toBeNull();
    // The activity head already carries the ASSIGNMENT kicker; the card does not repeat it.
    expect(screen.queryByText('Assignment', { exact: true })).toBeNull();
    expect(document.querySelector('[data-status="draft"]')).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(screen.getByRole('heading', { name: 'Instructions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your submission' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grading criteria' })).toBeInTheDocument();
  });

  it('renders container blocks in the instructions flat inside the assignment card', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    const assignment = {
      ...item.renders.en,
      instructions: { blocks: [{ id: 'acc', type: 'accordion', items: [{ id: 'a1', title: 'More', blocks: [] }] }] },
    } as never;

    render(<AssignmentRenderer assignment={assignment} target={{ blockId: null }} runtime={rt} hideTitle />);

    const accordion = screen.getByRole('button', { name: 'More' }).closest('.divide-y');
    expect(accordion).not.toBeNull();
    expect(accordion).not.toHaveClass('rounded-lg');
    expect(accordion).not.toHaveClass('bg-card');
  });

  it('stacks the link entry controls at narrow learner widths', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    const url = screen.getByRole('textbox', { name: 'Link URL' });
    const row = url.parentElement;
    expect(row).toHaveClass('flex-col', 'sm:flex-row');
    expect(url).toHaveClass('min-w-0', 'w-full');
    expect(screen.getByRole('button', { name: 'Add link' })).toHaveClass('w-full', 'sm:w-auto');
  });

  it('surfaces released feedback beside revision guidance', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue({
      locator: { courseId: 'c', itemId: 'a1', blockId: null },
      courseVersionId: 'version-1', attemptsUsed: 1,
      submissions: [{
        submissionId: 'submission-1', attemptNo: 1, status: 'changes_requested',
        submittedAt: '2026-09-03T05:00:00.000Z', payload: { text: 'First draft' }, files: [],
        grade: {
          released: true, decision: 'changes_requested', rubricScores: { c: 3 },
          totalPoints: 3, maxPoints: 5, passed: false,
          feedback: { vi: 'Sửa lại.', en: 'Please revise the evidence.' },
          gradedAt: '2026-09-03T06:00:00.000Z',
        },
      }],
      action: { allowed: true, kind: 'revision', expectedLatestSubmissionId: 'submission-1', nextAttemptNo: 2 },
    });

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByRole('region', { name: 'Latest feedback' })).toHaveTextContent('Please revise the evidence.');
    expect(screen.getByRole('region', { name: 'Latest feedback' })).toHaveTextContent('3 of 5');
    expect(screen.getByText('Revision draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit revision' })).toBeEnabled();
  });

  it('announces a successful submission and keeps the revision action available', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'Here is my product');
    await userEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Assignment submitted. Your work is ready for review.');
    expect(screen.getByRole('button', { name: 'Submit revision' })).toBeEnabled();
  });

  it('distinguishes unavailable submission data from a policy lock', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue(undefined);

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByText('Submission is unavailable right now. Reload this item to try again.')).toBeInTheDocument();
    expect(screen.queryByText(/policy does not allow a revision/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
  });

  it('submits a payload and shows status', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1; const rt = createPreviewRuntime(item, 'en');
    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'Here is my product');
    await userEvent.click(screen.getByRole('button', { name: /submit assignment/i }));
    expect((await screen.findAllByText(/submitted/i)).length).toBeGreaterThan(0); // status badge and "Submitted <date>" footer
    expect(document.querySelector('[data-status="submitted"]')).toHaveClass('bg-warning', 'text-warning-foreground');
    expect(rt.getBlockState<{ status: string }>('a1')?.status).toBe('submitted');
    expect(screen.getByText('Works')).toBeInTheDocument();
  });

  it('uses the server action, timestamp, files, score, and locale-first released feedback', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    const initial = {
      locator: { courseId: 'c', itemId: 'a1', blockId: null },
      courseVersionId: 'version-1',
      attemptsUsed: 1,
      submissions: [{
        submissionId: 'submission-1', attemptNo: 1, status: 'changes_requested' as const,
        submittedAt: '2026-09-03T05:00:00.000Z', payload: { text: 'First draft' },
        files: [{ assetId: 'asset-1', name: 'evidence.pdf', size: 2048, mime: 'application/pdf' }],
        grade: {
          released: true as const, decision: 'changes_requested' as const, rubricScores: { c: 3 },
          totalPoints: 3, maxPoints: 5, passed: false, feedback: { vi: 'Sửa lại.', en: 'Please revise.' },
          gradedAt: '2026-09-03T06:00:00.000Z',
        },
      }],
      action: { allowed: true as const, kind: 'revision' as const, expectedLatestSubmissionId: 'submission-1', nextAttemptNo: 2 },
    };
    const refreshed = {
      ...initial,
      attemptsUsed: 2,
      submissions: [{
        submissionId: 'submission-2', attemptNo: 2, status: 'submitted' as const,
        submittedAt: '2026-09-04T07:00:00.000Z', payload: { text: 'Revised draft' }, files: [],
      }, ...initial.submissions],
      action: { allowed: true as const, kind: 'revision' as const, expectedLatestSubmissionId: 'submission-2', nextAttemptNo: 3 },
    };
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue(initial);
    const submit = vi.spyOn(rt, 'submitAssignment').mockResolvedValue({ created: true, session: refreshed });

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByText('evidence.pdf')).toBeInTheDocument();
    expect(screen.getByText(/3 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/Please revise\./)).toBeInTheDocument();
    const notes = screen.getByRole('textbox', { name: /notes/i });
    await userEvent.clear(notes);
    await userEvent.type(notes, 'Revised draft');
    await userEvent.click(screen.getByRole('button', { name: 'Submit revision' }));

    expect(submit).toHaveBeenCalledWith(
      { blockId: null },
      expect.objectContaining({
        text: 'Revised draft',
        files: [{ assetId: 'asset-1', name: 'evidence.pdf', size: 2048, mime: 'application/pdf' }],
      }),
      'submission-1',
    );
    expect(await screen.findByText(/04\/09\/2026|9\/4\/2026/)).toBeInTheDocument();
  });

  it('keeps an inline block target explicit even when its id equals the item id', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.l1;
    const rt = createPreviewRuntime(item, 'en');
    const submit = vi.spyOn(rt, 'submitAssignment');
    const block = {
      id: 'l1', type: 'assignment', title: 'Inline work', instructions: rc('Explain it'),
      submission: { accepts: ['text'] }, resubmission: 'until_approved',
    } as never;

    render(<AssignmentBlockRenderer block={block} runtime={rt} path="/blocks/0" depth={0} />);
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'Inline response');
    await userEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));

    expect(submit).toHaveBeenCalledWith(
      { blockId: 'l1' },
      expect.objectContaining({ text: 'Inline response' }),
      null,
    );
  });

  it('guards duplicate assignment submission synchronously with one expected latest id', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    const submit = vi.spyOn(rt, 'submitAssignment').mockImplementation(() => new Promise(() => {}));

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'One request');
    const button = screen.getByRole('button', { name: 'Submit assignment' });
    button.click();
    button.click();

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({ blockId: null }, expect.any(Object), null);
  });

  it('preserves earned activity completion while drafting a revision', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);
    const notes = screen.getByRole('textbox', { name: /notes/i });
    await userEvent.type(notes, 'Accepted work');
    await userEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    expect(rt.getBlockState<{ completed?: boolean }>('a1')?.completed).toBe(true);

    await userEvent.type(notes, ' with a revision');

    expect(rt.getBlockState<{ status?: string; completed?: boolean }>('a1')).toMatchObject({
      status: 'draft',
      completed: true,
    });
  });

  it('recovers a stale revision with the canonical action and preserves the unsent draft', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    const initial = {
      locator: { courseId: 'c', itemId: 'a1', blockId: null },
      courseVersionId: 'version-1', attemptsUsed: 1,
      submissions: [{
        submissionId: 'submission-1', attemptNo: 1, status: 'submitted' as const,
        submittedAt: '2026-09-03T05:00:00.000Z', payload: { text: 'Original' }, files: [],
      }],
      action: { allowed: true as const, kind: 'revision' as const, expectedLatestSubmissionId: 'submission-1', nextAttemptNo: 2 },
    };
    const refreshed = {
      ...initial,
      attemptsUsed: 2,
      submissions: [{
        submissionId: 'submission-2', attemptNo: 2, status: 'submitted' as const,
        submittedAt: '2026-09-03T06:00:00.000Z', payload: { text: 'Other tab' }, files: [],
      }, ...initial.submissions],
      action: { allowed: true as const, kind: 'revision' as const, expectedLatestSubmissionId: 'submission-2', nextAttemptNo: 3 },
    };
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue(initial);
    const refresh = vi.fn().mockResolvedValue(refreshed);
    (rt as typeof rt & { refreshAssignmentSession: typeof refresh }).refreshAssignmentSession = refresh;
    const submit = vi.spyOn(rt, 'submitAssignment')
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'SUBMISSION_STALE' }))
      .mockResolvedValueOnce({ created: true, session: refreshed });

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);
    const notes = screen.getByRole('textbox', { name: /notes/i });
    await userEvent.clear(notes);
    await userEvent.type(notes, 'My unsent revision');
    await userEvent.click(screen.getByRole('button', { name: 'Submit revision' }));

    expect(await screen.findByText(/latest submission history was loaded/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledWith({ blockId: null });
    expect(notes).toHaveValue('My unsent revision');

    await userEvent.click(screen.getByRole('button', { name: 'Submit revision' }));
    expect(submit).toHaveBeenLastCalledWith(
      { blockId: null },
      expect.objectContaining({ text: 'My unsent revision' }),
      'submission-2',
    );
  });

  it('keeps sub-millisecond newer local drafts over an older server submission', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'en');
    rt.setBlockState('a1', {
      status: 'draft', payload: { text: 'Microsecond-newer draft' }, updatedAt: '2026-09-03T05:00:00.123900Z',
    });
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue({
      locator: { courseId: 'c', itemId: 'a1', blockId: null },
      courseVersionId: 'version-1', attemptsUsed: 1,
      submissions: [{
        submissionId: 'submission-1', attemptNo: 1, status: 'submitted',
        submittedAt: '2026-09-03T05:00:00.123100Z', payload: { text: 'Older submission' }, files: [],
      }],
      action: { allowed: true, kind: 'revision', expectedLatestSubmissionId: 'submission-1', nextAttemptNo: 2 },
    });

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByRole('textbox', { name: /notes/i })).toHaveValue('Microsecond-newer draft');
  });

  it('obeys preview assignment resubmission policies and the attempt ceiling', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const target = { blockId: null } as const;

    item.grading.assignments!.a1.resubmission = 'never';
    const neverRuntime = createPreviewRuntime(item, 'en');
    await neverRuntime.submitAssignment(target, { text: 'First' }, null);
    expect(neverRuntime.getAssignmentSession(target)!.action).toEqual({ allowed: false, reason: 'policy' });

    item.grading.assignments!.a1.resubmission = 'once';
    const onceRuntime = createPreviewRuntime(item, 'en');
    const first = await onceRuntime.submitAssignment(target, { text: 'First' }, null);
    expect(first.session.action).toMatchObject({ allowed: true, kind: 'revision', nextAttemptNo: 2 });
    const second = await onceRuntime.submitAssignment(target, { text: 'Second' }, first.session.submissions[0].submissionId);
    expect(second.session.action).toEqual({ allowed: false, reason: 'policy' });

    item.grading.assignments!.a1.resubmission = 'until_approved';
    const boundedRuntime = createPreviewRuntime(item, 'en');
    let expected: string | null = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = await boundedRuntime.submitAssignment(target, { text: `Attempt ${attempt}` }, expected);
      expected = result.session.submissions[0].submissionId;
    }
    expect(boundedRuntime.getAssignmentSession(target)!.action).toEqual({ allowed: false, reason: 'attempt_limit' });
  });

  it('falls back from the requested locale to available released feedback', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.a1;
    const rt = createPreviewRuntime(item, 'vi');
    vi.spyOn(rt, 'getAssignmentSession').mockReturnValue({
      locator: { courseId: 'c', itemId: 'a1', blockId: null },
      courseVersionId: 'version-1', attemptsUsed: 1,
      submissions: [{
        submissionId: 'submission-1', attemptNo: 1, status: 'changes_requested',
        submittedAt: '2026-09-03T05:00:00.000Z', payload: { text: 'Draft' }, files: [],
        grade: {
          released: true, decision: 'changes_requested', rubricScores: {}, totalPoints: 1, maxPoints: 5,
          passed: false, feedback: { en: 'English fallback.' }, gradedAt: '2026-09-03T06:00:00.000Z',
        },
      }],
      action: { allowed: false, reason: 'policy' },
    });

    render(<AssignmentRenderer assignment={item.renders.en} target={{ blockId: null }} runtime={rt} />);

    expect(screen.getByText(/English fallback\./)).toBeInTheDocument();
  });
});

describe('ExamPreviewRenderer', () => {
  it('shows settings, sections, pool placeholders and grades a section', async () => {
    const r = await compileCourse({ manifest, items }, resolver);
    const item = r.compiled!.items.e1; const rt = createPreviewRuntime(item, 'en');
    render(<ExamPreviewRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.getByText(/20 min/)).toBeInTheDocument();
    expect(screen.getByText(/2 questions drawn from pool "p"/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: /grade section/i }));
    expect(await screen.findByText(/100%/)).toBeInTheDocument();
  });
});

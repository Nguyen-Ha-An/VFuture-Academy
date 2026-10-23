// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { GradingWorkbench } from '@/features/instructor-grading/GradingWorkbench';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const assignment = { kind: 'assignment', submission: { id: 'submission-1', userId: 'learner', learnerName: 'Learner', branchId: 'branch-a', courseVersionId: 'version-1', itemId: 'lesson-1', blockId: 'assignment-1', assignmentId: 'assignment-1', attemptNo: 1, status: 'submitted', submittedAt: '2026-09-07T00:00:00.000Z', payload: { text: 'Answer' }, files: [], grade: { rubricScores: { quality: 2 }, feedback: 'Existing feedback', decision: 'changes_requested', released: false, passed: false, totalPoints: 2, maxPoints: 4, gradedAt: '2026-09-07T00:00:00.000Z' } }, source: { itemId: 'lesson-1', courseVersion: 1, prompt: { id: 'assignment-1', type: 'assignment', title: 'Pinned assignment', instructions: { blocks: [] }, submission: { accepts: ['text'] } }, rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] } } };
const exam = { kind: 'exam', learnerName: 'Learner', attempt: { attemptId: 'attempt-1', branchId: 'branch-a', courseVersionId: 'version-1', itemId: 'exam-1', status: 'pending_manual', releasedAt: null, resultAvailableAt: null, points: null, maxPoints: null, percent: null }, questions: [{ questionId: 'auto', type: 'single_choice', prompt: { id: 'auto', type: 'single_choice', content: { blocks: [] }, options: [] }, grading: { points: 1 }, answer: 'a', result: { status: 'correct' }, manualPoints: null, manualFeedback: null }, { questionId: 'manual', type: 'essay', prompt: { id: 'manual', type: 'essay', content: { blocks: [] } }, grading: { points: 4 }, answer: 'Essay', result: { status: 'pending_manual' }, manualPoints: 2, manualFeedback: 'Earlier feedback' }] };
const messages = staffUiTestMessages(en, 'en');
const completedAttempt = { attemptId: 'attempt-1', branchId: 'branch-a', courseVersionId: 'version-1', itemId: 'exam-1', status: 'graded', releasedAt: null, resultAvailableAt: '2026-09-07T04:10:00.000Z', points: 3, maxPoints: 5, percent: 60 };

function view(kind: 'assignments' | 'exams', canRelease = false, extra: Partial<ComponentProps<typeof GradingWorkbench>> = {}) { return render(<NextIntlClientProvider locale="en" messages={messages}><GradingWorkbench kind={kind} id="id" actorId="actor" scope="branch:branch-a" locale="en" canRelease={canRelease} {...extra} /></NextIntlClientProvider>); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });

describe('grading workbench · assignments', () => {
  it('loads existing grades and retains assignment edits after a failed save', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: assignment })).mockResolvedValueOnce(json({ error: { message: 'Nope' } }, 500));
    vi.stubGlobal('fetch', fetchMock); view('assignments');
    expect(await screen.findByDisplayValue('Existing feedback')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pinned assignment' })).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Feedback' })); await userEvent.type(screen.getByRole('textbox', { name: 'Feedback' }), 'Kept');
    await userEvent.click(screen.getByRole('button', { name: 'Save grading draft' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getByDisplayValue('Kept')).toBeInTheDocument();
  });

  it('renders pinned assignment instructions without learner submission controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    view('assignments');
    expect(await screen.findByRole('heading', { name: 'Pinned assignment' })).toBeInTheDocument();
    expect(screen.queryByText('Not submitted')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit assignment' })).not.toBeInTheDocument();
  });

  it('identifies the submitted work and separates the pinned instructions from the learner response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    view('assignments');
    expect(await screen.findByText('Reviewing Learner · attempt 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pinned instructions' })).toBeInTheDocument();
    expect(screen.getAllByText('Learner response')).toHaveLength(1);
    expect(screen.getAllByText('Published version source').some((label) => label.closest('summary'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Save grading draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeInTheDocument();
  });

  it('saves a partial draft but refuses completion until every criterion is scored', async () => {
    const twoCriteria = { ...assignment, submission: { ...assignment.submission, grade: undefined }, source: { ...assignment.source, rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }, { id: 'depth', name: 'Depth', maxPoints: 4 }] } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: twoCriteria })).mockResolvedValue(json({ data: { submission: { ...twoCriteria.submission, grade: { rubricScores: { quality: 3 }, feedback: '', decision: 'approved', released: false, totalPoints: 3, maxPoints: 8, gradedAt: '2026-09-07T01:00:00.000Z' } } } }));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await userEvent.type(await screen.findByRole('spinbutton', { name: 'Quality' }), '3');
    expect(screen.getByRole('button', { name: 'Save grading draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeDisabled();
    expect(screen.getByText('Every criterion needs a valid score before grading can be completed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save grading draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Grading draft saved.');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).release).toBe(false);
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Depth' }), '2');
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
  });

  it('blocks a draft save whose score exceeds the criterion maximum', async () => {
    const ungraded = { ...assignment, submission: { ...assignment.submission, grade: undefined } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: ungraded })));
    view('assignments');
    await userEvent.type(await screen.findByRole('spinbutton', { name: 'Quality' }), '5');
    expect(screen.getByRole('button', { name: 'Save grading draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeDisabled();
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Quality' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Quality' }), '4');
    expect(screen.getByRole('button', { name: 'Save grading draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
  });

  it('shows the score and feedback and locks from the completion response', async () => {
    const completed = { ...assignment.submission, status: 'approved', grade: { ...assignment.submission.grade, rubricScores: { quality: 4 }, feedback: 'Published feedback', decision: 'approved', released: true, totalPoints: 4, maxPoints: 4, gradedAt: '2026-09-07T01:00:00.000Z' } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: assignment })).mockResolvedValueOnce(json({ data: { submission: completed } }));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await screen.findByDisplayValue('Existing feedback');
    await userEvent.click(screen.getByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Grading completed. The learner can see the score and feedback.');
    expect(screen.getByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
    const completedPanel = screen.getByRole('heading', { name: 'Completed result' }).closest('section')!;
    expect(completedPanel).toHaveTextContent('4 / 4');
    expect(completedPanel).toHaveTextContent('Published feedback');
    expect(screen.getByText('This completed grade is immutable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save grading draft' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Feedback' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Feedback' })).toHaveValue('Published feedback');
  });

  it('does not announce or lock completion without a server-confirmed released grade', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: assignment }))
      .mockResolvedValueOnce(json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await screen.findByDisplayValue('Existing feedback');

    await userEvent.click(screen.getByRole('button', { name: 'Complete grading' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.queryByText('Grading completed. The learner can see the score and feedback.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
  });

  it('does not lock when a completion attempt is rejected as incomplete', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: assignment }))
      .mockResolvedValueOnce(json({ error: { code: 'RUBRIC_INCOMPLETE', message: 'incomplete' } }, 409));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await screen.findByDisplayValue('Existing feedback');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Feedback' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Feedback' }), 'Retained draft');
    await userEvent.click(screen.getByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Every rubric criterion needs a score before grading is completed.');
    expect(screen.getByDisplayValue('Retained draft')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Feedback' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Completed result' })).not.toBeInTheDocument();
  });

  it('reports a stale learner revision without discarding the grading draft', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: assignment }))
      .mockResolvedValueOnce(json({ error: { code: 'STALE_SUBMISSION', message: 'stale' } }, 409));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await screen.findByDisplayValue('Existing feedback');
    await userEvent.click(screen.getByRole('button', { name: 'Save grading draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The learner submitted a newer revision');
    expect(screen.getByDisplayValue('Existing feedback')).toBeInTheDocument();
  });

  it('switches accessible mobile prompt and grading tabs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment }))); view('assignments');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves mobile grading tabs with the keyboard and keeps focus with the active panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment }))); view('assignments');
    const [prompt, grading] = await screen.findAllByRole('tab');
    prompt.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(grading).toHaveFocus();
    expect(grading).toHaveAttribute('aria-selected', 'true');
    expect(grading).toHaveAttribute('aria-controls');
    expect(document.getElementById(grading.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel');
  });
});

describe('grading workbench · exams', () => {
  it('keeps automatic questions read-only and loads manual points', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: exam }))); view('exams', true);
    expect(await screen.findByText('This question is automatically graded and read-only.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /2\. Essay/ }));
    expect(await screen.findByDisplayValue('Earlier feedback')).toBeInTheDocument();
    expect(screen.getByLabelText('Points')).toHaveValue(2);
  });

  it('uses localized question labels and shows the remaining manual-grading count', async () => {
    const awaitingManualScore = { ...exam, questions: [exam.questions[0], { ...exam.questions[1], manualPoints: null, manualFeedback: null }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: awaitingManualScore })));
    view('exams', true);
    expect(await screen.findByRole('button', { name: /1\. Single choice/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\. Essay/ })).toBeInTheDocument();
    expect(screen.getByText('1 manual question remaining')).toBeInTheDocument();
  });

  it('keeps an already-scored manual question editable until grading is completed', async () => {
    // The save clears the question's pending_manual result; the field must stay editable so a
    // score can be revised before completion.
    const rescored = { ...exam, questions: [exam.questions[0], { ...exam.questions[1], result: { status: 'partial', points: 2, maxPoints: 4 } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: rescored })));
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: /2\. Essay/ }));
    const points = await screen.findByLabelText('Points');
    expect(points).toBeEnabled();
    expect(screen.getByLabelText('Feedback')).toBeEnabled();
    await userEvent.clear(points);
    await userEvent.type(points, '4');
    expect(screen.getByRole('button', { name: 'Save question grade' })).toBeEnabled();
  });

  it('keeps a regex-fallback short answer manually gradable before and after its first save', async () => {
    // A short_answer whose safe-regex fallback could not decide arrives as pending_manual with no
    // stored score. Saving it clears pending_manual, so the stored score is the only remaining
    // evidence that it is a manual question — it must stay editable and keep its nav marker.
    const fallbackQuestion = { questionId: 'fallback', type: 'short_answer', prompt: { id: 'fallback', type: 'short_answer', content: { blocks: [] } }, grading: { points: 3 }, answer: 'maybe', result: { status: 'pending_manual' }, manualPoints: null, manualFeedback: null };
    const beforeSave = { ...exam, questions: [exam.questions[0], fallbackQuestion], manualGrading: { total: 1, scored: 0, outstanding: ['fallback'], complete: false } };
    const afterSave = { ...exam, questions: [exam.questions[0], { ...fallbackQuestion, result: { status: 'partial', points: 2, maxPoints: 3 }, manualPoints: 2, manualFeedback: 'Accepted' }], manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: beforeSave }))
      .mockResolvedValueOnce(json({ data: exam.attempt }))
      .mockResolvedValue(json({ data: afterSave }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');

    await userEvent.click(await screen.findByRole('button', { name: /2\. Short answer.*unscored/ }));
    const points = await screen.findByLabelText('Points');
    expect(points).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeDisabled();
    await userEvent.type(points, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save question grade' }));
    await screen.findByRole('status');

    // After the save the result is no longer pending_manual, but the stored score keeps it manual.
    await waitFor(() => expect(screen.getByLabelText('Points')).toHaveValue(2));
    expect(screen.getByLabelText('Points')).toBeEnabled();
    expect(screen.getByRole('button', { name: /2\. Short answer.*· 2/ })).toBeInTheDocument();
    expect(screen.queryByText('This question is automatically graded and read-only.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
  });

  it('derives the completion gate from the same evidence when the server omits manualGrading', async () => {
    // No manualGrading in the payload: the local fallback must still recognise a pending_manual
    // regex fallback as an unscored manual question.
    const fallbackQuestion = { questionId: 'fallback', type: 'short_answer', prompt: { id: 'fallback', type: 'short_answer', content: { blocks: [] } }, grading: { points: 3 }, answer: 'maybe', result: { status: 'pending_manual' }, manualPoints: null, manualFeedback: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { ...exam, questions: [exam.questions[0], fallbackQuestion] } })));
    view('exams');
    expect(await screen.findByRole('button', { name: 'Complete grading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /2\. Short answer.*unscored/ })).toBeInTheDocument();
  });

  it('gates completion on the server progress and marks the outstanding questions', async () => {
    const outstanding = { ...exam, manualGrading: { total: 2, scored: 1, outstanding: ['manual'], complete: false } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: outstanding })));
    view('exams');
    expect(await screen.findByRole('button', { name: 'Complete grading' })).toBeDisabled();
    expect(screen.getByText(/Scored 1 of 2\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\. Essay.*unscored/ })).toBeInTheDocument();
  });

  it('enables completion when the server reports every manual question scored', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: ready })));
    view('exams');
    expect(await screen.findByRole('button', { name: 'Complete grading' })).toBeEnabled();
  });

  it('completes grading and locks the workbench from the returned final state', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const finalDetail = { ...ready, attempt: completedAttempt, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: ready }))
      .mockResolvedValueOnce(json({ data: { attempt: completedAttempt, transitioned: true } }))
      .mockResolvedValueOnce(json({ data: finalDetail }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Grading completed. The learner can see the score and feedback.');
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/v1/studio/exams/attempts/attempt-1/complete-grading');
    expect(fetchMock.mock.calls[1][1].body).toBe('{}');
    expect(screen.getByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
    expect(screen.getByText('3 / 5 · 60%')).toBeInTheDocument();
    expect(screen.getByText('The learner can see this score and feedback now.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Complete grading' })).not.toBeInTheDocument());
    expect(screen.getByText('Grading is complete; scores can no longer be edited.')).toBeInTheDocument();
  });

  it('locks without re-announcing when the attempt was already complete', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: ready }))
      .mockResolvedValueOnce(json({ data: { attempt: completedAttempt, transitioned: false } }))
      .mockResolvedValueOnce(json({ data: { ...ready, attempt: completedAttempt } }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('status')).toHaveTextContent('This attempt was already completed. Showing the final result.');
    expect(screen.getByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
  });

  it('does not lock on a malformed completion success and keeps the saved scores', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: ready }))
      .mockResolvedValueOnce(json({ data: { attempt: { ...completedAttempt, resultAvailableAt: null }, transitioned: true } }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not fully confirm the completion.');
    expect(screen.queryByRole('heading', { name: 'Completed result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /2\. Essay/ }));
    await waitFor(() => expect(screen.getByLabelText('Points')).toHaveValue(2));
    expect(screen.getByLabelText('Points')).toBeEnabled();
  });

  it('keeps edits and refreshes when the server rejects completion as incomplete', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const refreshed = { ...exam, manualGrading: { total: 2, scored: 1, outstanding: ['manual'], complete: false } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: ready }))
      .mockResolvedValueOnce(json({ error: { code: 'MANUAL_GRADING_INCOMPLETE', message: 'incomplete' } }, 409))
      .mockResolvedValueOnce(json({ data: refreshed }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A manual question still has no valid score.');
    await waitFor(() => expect(screen.getByRole('button', { name: /2\. Essay.*unscored/ })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Completed result' })).not.toBeInTheDocument();
  });

  it('offers a retry that retains edits when a concurrent grader wins the race', async () => {
    const ready = { ...exam, manualGrading: { total: 1, scored: 1, outstanding: [], complete: true } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: ready }))
      .mockResolvedValueOnce(json({ error: { code: 'GRADING_CONFLICT', message: 'conflict' } }, 409));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete grading' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another grader just changed this attempt.');
    expect(screen.getByRole('button', { name: 'Complete grading' })).toBeEnabled();
    // No refresh call: the grader's own view is preserved for the retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches a saved manual grade so switching questions does not restore stale values', async () => {
    const twoQuestions = { ...exam, questions: [
      exam.questions[1],
      { ...exam.questions[1], questionId: 'manual-2', manualPoints: null, manualFeedback: null },
    ] };
    const refreshed = { ...twoQuestions, questions: [
      { ...exam.questions[1], manualPoints: 3, manualFeedback: 'Updated feedback', result: { status: 'partial', points: 3, maxPoints: 4 } },
      twoQuestions.questions[1],
    ] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: twoQuestions }))
      .mockResolvedValueOnce(json({ data: { ...twoQuestions.attempt } }))
      .mockResolvedValueOnce(json({ data: refreshed }));
    vi.stubGlobal('fetch', fetchMock);
    view('exams');
    const points = await screen.findByLabelText('Points');
    await userEvent.clear(points);
    await userEvent.type(points, '3');
    await userEvent.clear(screen.getByLabelText('Feedback'));
    await userEvent.type(screen.getByLabelText('Feedback'), 'Updated feedback');
    await userEvent.click(screen.getByRole('button', { name: 'Save question grade' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('status')).toHaveTextContent('Question grade saved.');
    await userEvent.click(screen.getByRole('button', { name: /2\. Essay/ }));
    await userEvent.click(screen.getByRole('button', { name: /1\. Essay/ }));
    await waitFor(() => expect(screen.getByLabelText('Points')).toHaveValue(3));
    expect(screen.getByLabelText('Feedback')).toHaveValue('Updated feedback');
  });

  it('does not offer manual grading or completion after an attempt is finalized', async () => {
    const finalized = { ...exam, attempt: { ...exam.attempt, status: 'graded', resultAvailableAt: '2026-09-07T04:10:00.000Z', points: 3, maxPoints: 5, percent: 60 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: finalized })));
    view('exams');
    await userEvent.click(await screen.findByRole('button', { name: /2\. Essay/ }));
    expect(screen.queryByRole('button', { name: 'Save question grade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete grading' })).not.toBeInTheDocument();
    expect(screen.getByText('This question is no longer pending manual grading.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
  });

  it('offers the legacy release affordance only for a historical result with no availability', async () => {
    const legacy = { ...exam, attempt: { ...exam.attempt, status: 'graded', releasedAt: null, resultAvailableAt: null, points: 3, maxPoints: 5, percent: 60 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: legacy })));
    const rendered = view('exams', true);
    expect(await screen.findByText('Legacy unreleased result')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open legacy result release' })).toHaveAttribute('href', expect.stringContaining('/grading/assessments?branchId=branch-a'));
    rendered.unmount();

    // A newly completed attempt owns its result already, so it must not offer legacy release.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { ...exam, attempt: completedAttempt } })));
    view('exams', true);
    expect(await screen.findByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
    expect(screen.queryByText('Legacy unreleased result')).not.toBeInTheDocument();
  });

  it('hides the legacy release affordance from a grader without release permission', async () => {
    const legacy = { ...exam, attempt: { ...exam.attempt, status: 'graded', releasedAt: null, resultAvailableAt: null, points: 3, maxPoints: 5, percent: 60 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: legacy })));
    view('exams', false);
    expect(await screen.findByRole('heading', { name: 'Completed result' })).toBeInTheDocument();
    expect(screen.queryByText('Legacy unreleased result')).not.toBeInTheDocument();
  });
});

describe('grading workbench · navigation', () => {
  it('clears old detail and ignores an obsolete response when the identity changes', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveNew = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const rendered = view('assignments');
    rendered.rerender(<NextIntlClientProvider locale="en" messages={messages}><GradingWorkbench kind="assignments" id="new-id" actorId="actor" scope="branch:branch-a" locale="en" /></NextIntlClientProvider>);
    expect(screen.getByText('Loading grading workbench…')).toBeInTheDocument();
    resolveNew(json({ data: { ...assignment, source: { ...assignment.source, itemId: 'new-source' } } }));
    expect(await screen.findByText('Reviewing Learner · attempt 1')).toBeInTheDocument();
    expect(screen.queryByText('new-source')).not.toBeInTheDocument();
    expect(screen.getAllByText('Pinned assignment').length).toBeGreaterThan(1);
    resolveOld(json({ data: { ...assignment, source: { ...assignment.source, itemId: 'old-source' } } }));
    await act(async () => {});
    expect(screen.queryByText('old-source')).not.toBeInTheDocument();
  });

  it('accepts only allowlisted grading back links', async () => {
    window.history.replaceState({}, '', '/grading/assignments/id?back=https%3A%2F%2Fevil.example');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    const rendered = view('assignments');
    expect(await screen.findByRole('link', { name: 'Back to grading queue' })).toHaveAttribute('href', '/grading/queue');
    rendered.unmount();

    window.history.replaceState({}, '', '/grading/assignments/id?back=%2Fauth%2Fsignout');
    const second = view('assignments');
    expect(await screen.findByRole('link', { name: 'Back to grading queue' })).toHaveAttribute('href', '/grading/queue');
    second.unmount();

    window.history.replaceState({}, '', '/grading/assignments/id?back=%2Fgrading%2Fassessments%3FbranchId%3Dbranch-a');
    view('assignments');
    // The label follows the target: an assessments back link no longer claims to be the queue.
    expect(await screen.findByRole('link', { name: 'Back to assignments & exams' })).toHaveAttribute('href', '/grading/assessments?branchId=branch-a');
    expect(screen.queryByRole('link', { name: 'Back to grading queue' })).not.toBeInTheDocument();
  });

  it('names each allowlisted back target, keeping the queue label for the queue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: exam })));
    for (const [back, label] of [
      ['/grading/queue?tab=exams', 'Back to grading queue'],
      ['/grading/assessments?tab=exams', 'Back to assignments & exams'],
      ['/grading/reports', 'Back to learning reports'],
      ['/grading', 'Back to grading overview'],
    ] as const) {
      window.history.replaceState({}, '', `/grading/exams/id?back=${encodeURIComponent(back)}`);
      const rendered = view('exams');
      expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', back);
      rendered.unmount();
    }
  });

  it('keeps the Vietnamese queue label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    render(<NextIntlClientProvider locale="vi" messages={staffUiTestMessages(viMessages, 'vi')}><GradingWorkbench kind="assignments" id="id" actorId="actor" scope="branch:branch-a" locale="vi" /></NextIntlClientProvider>);
    expect(await screen.findByRole('link', { name: 'Quay lại danh sách' })).toHaveAttribute('href', '/grading/queue');
  });

  it('offers the server-computed next record, and only a grading workbench link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    const rendered = view('assignments', false, { nextHref: '/grading/assignments/submission-2?branchId=branch-a&back=%2Fgrading%2Fqueue' });
    expect(await screen.findByRole('link', { name: 'Next in queue' })).toHaveAttribute('href', '/grading/assignments/submission-2?branchId=branch-a&back=%2Fgrading%2Fqueue');
    rendered.unmount();

    const none = view('assignments', false, { nextHref: null });
    await screen.findByText('Reviewing Learner · attempt 1');
    expect(screen.queryByRole('link', { name: 'Next in queue' })).not.toBeInTheDocument();
    none.unmount();

    view('assignments', false, { nextHref: 'https://evil.example/grading/assignments/x' });
    await screen.findByText('Reviewing Learner · attempt 1');
    expect(screen.queryByRole('link', { name: 'Next in queue' })).not.toBeInTheDocument();
  });
});

describe('grading workbench · resolved titles', () => {
  it('names the assignment by its course and item titles instead of raw ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    view('assignments', false, { titles: { course: 'Design thinking', item: 'Week 1 reflection' } });
    expect(await screen.findByText('Reviewing Learner · attempt 1')).toBeInTheDocument();
    expect(screen.getByText('Design thinking · Week 1 reflection')).toBeInTheDocument();
    expect(screen.getAllByText('Week 1 reflection').length).toBeGreaterThan(1);
    expect(screen.queryByText('lesson-1')).not.toBeInTheDocument();
  });

  it('never puts the raw item id in the header when no title was resolved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    view('assignments', false, { titles: null });
    await screen.findByText('Reviewing Learner · attempt 1');
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(header).not.toHaveTextContent('lesson-1');
    expect(header).not.toHaveTextContent('assignment-1');
  });

  it('uses the pinned assignment title in source details when the catalog title is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: assignment })));
    view('assignments', false, { titles: null });
    await screen.findByText('Reviewing Learner · attempt 1');
    const sourceDetails = screen.getAllByText('Assessment').map((label) => label.closest('dl'));
    expect(sourceDetails).toHaveLength(2);
    for (const details of sourceDetails) {
      expect(details).toHaveTextContent('Pinned assignment');
      expect(details).not.toHaveTextContent('lesson-1');
    }
  });

  it('localizes a pinned source title when it is stored as a language map', async () => {
    const localizedAssignment = { ...assignment, source: { ...assignment.source, prompt: { ...assignment.source.prompt, title: { vi: 'Bài phản ánh', en: 'Reflection assignment' } } } };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ data: localizedAssignment })));
    view('assignments', false, { titles: null });
    expect(await screen.findByRole('heading', { name: 'Reflection assignment' })).toBeInTheDocument();
    expect(screen.getAllByText('Reflection assignment').length).toBeGreaterThan(1);
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });

  it('names the exam in the header from the server titles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: exam })));
    view('exams', false, { titles: { course: 'Design thinking', item: 'Midterm exam' } });
    expect(await screen.findByText('Design thinking · Midterm exam')).toBeInTheDocument();
    expect(screen.queryByText('exam-1')).not.toBeInTheDocument();
  });
});

describe('grading workbench · status', () => {
  it('announces through a single status region, with no toast', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: assignment })).mockResolvedValue(json({ data: { submission: assignment.submission } }));
    vi.stubGlobal('fetch', fetchMock);
    view('assignments');
    await screen.findByDisplayValue('Existing feedback');
    await userEvent.click(screen.getByRole('button', { name: 'Save grading draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Grading draft saved.');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

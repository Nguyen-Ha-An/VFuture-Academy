// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';
import { ItemPlayer } from '../../e2e/learner-harness/src/item-player';
import { ASSIGNMENT_COURSE, assignmentSession, publishedAssignment, publishedExam, publishedLesson } from '../../e2e/learner-harness/src/activity-fixtures';
const locator = { courseId: ASSIGNMENT_COURSE, itemId: 'assignment', blockId: null };
const wrap = (child: React.ReactNode) => <NextIntlClientProvider locale="en" messages={withBenchMessages(en, 'en')} timeZone="Asia/Ho_Chi_Minh">{child}</NextIntlClientProvider>;
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); sessionStorage.clear(); });

describe('learner harness mounts actual activity engines', () => {
  it('uses real LessonRenderer content instead of the former static article stand-in', () => {
    render(wrap(<ItemPlayer item={publishedLesson('en', 'first', 'Published lesson')} />));
    expect(screen.getAllByText('Practice using technology responsibly. Compare the evidence and explain what would change your decision.')).toHaveLength(5);
    expect(screen.queryByRole('article', { name: 'Fixture lesson' })).not.toBeInTheDocument();
  });
  it.each(['submitted', 'unreleased', 'feedback'])('renders actual assignment %s state with released-feedback gating', state => {
    window.history.replaceState({}, '', `/app?assignmentState=${state}`);
    render(wrap(<ItemPlayer item={publishedAssignment('en')} assignmentSessions={{ assignment: assignmentSession(locator, 'en', state) }} />));
    expect(screen.getByRole('region', { name: 'Submission history' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Latest feedback' }) !== null).toBe(state === 'feedback');
    if (state === 'feedback') expect(screen.getByRole('region', { name: 'Latest feedback' })).toHaveTextContent('7 of 10');
  });
  it('uses actual upload progress/cancel controls with the disposable runtime', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/app?upload=pending');
    render(wrap(<ItemPlayer item={publishedAssignment('en')} assignmentSessions={{ assignment: assignmentSession(locator, 'en') }} />));
    await user.upload(screen.getByLabelText('Upload files'), new File(['evidence'], 'evidence.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('progressbar', { name: 'Upload progress for evidence.txt' })).toHaveAttribute('aria-valuenow', '25');
    await user.click(screen.getByRole('button', { name: 'Cancel evidence.txt' }));
    expect(await screen.findByText('Upload cancelled for evidence.txt')).toBeVisible();
  });
  it('keeps actual upload error/retry and submission error/retry states usable', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/app?assignmentState=submit-error&upload=error');
    render(wrap(<ItemPlayer item={publishedAssignment('en')} assignmentSessions={{ assignment: assignmentSession(locator, 'en', 'submit-error') }} />));
    await user.upload(screen.getByLabelText('Upload files'), new File(['evidence'], 'evidence.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Upload failed for evidence.txt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry evidence.txt' }));
    expect(await screen.findByRole('button', { name: 'remove' })).toBeVisible();
    expect(screen.getByText('evidence.txt', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry evidence.txt' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit assignment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The assignment could not be submitted. Try again.');
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('A local draft remains available after an unsuccessful submission.');
    await user.click(screen.getByRole('button', { name: 'Submit assignment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Assignment submitted. Your work is ready for review.');
  });
  it('uses actual ExamFlow intro and start to reach the actual ExamPlayer', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/app?examState=intro');
    render(wrap(<ItemPlayer item={publishedExam('en')} />));
    await user.click(await screen.findByRole('button', { name: 'Start exam' }));
    expect(await screen.findByRole('timer')).toBeVisible();
    expect(screen.getByText('Which value resists outliers?')).toBeVisible();
  });
  it('renders actual pending-manual review without a fabricated zero score or released answers', async () => {
    window.history.replaceState({}, '', '/app?examState=unreleased');
    render(wrap(<ItemPlayer item={publishedExam('en')} />));
    expect(await screen.findByText('Your score is not available yet.')).toBeVisible();
    expect(screen.getByText('Awaiting grading')).toBeVisible();
    expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 of 2/)).not.toBeInTheDocument();
  });
  it('acknowledges answered questions so actual autosave permits submission into review', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/app?examState=active');
    render(wrap(<ItemPlayer item={publishedExam('en')} />));
    await user.click(await screen.findByRole('radio', { name: 'Median' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('radio', { name: 'Mode' }));
    await user.click(screen.getByRole('button', { name: 'Submit exam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Submit exam?' });
    expect(dialog).toHaveTextContent('Every question has an answer.');
    await user.click(within(dialog).getByRole('button', { name: 'Submit now' }));
    expect(await screen.findByText(/50%/)).toBeVisible();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

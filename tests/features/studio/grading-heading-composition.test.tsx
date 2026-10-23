// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { GradingOperations } from '@/features/instructor-grading/GradingOperations';
import { SubmissionsWorkspace } from '@/features/instructor-grading/SubmissionsWorkspace';

vi.mock('@/features/notebooks/ui/NotebookSubmissionPreview', () => ({ NotebookSubmissionPreview: () => null }));

const messages = staffUiTestMessages(en, 'en');

const props = {
  branches: [{ id: 'branch-a', name: 'Branch A' }],
  courses: [{ id: 'course-a', title: 'Course A' }],
  assignments: [],
  exams: [],
  gradingBranchIds: ['branch-a'],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('grading queue heading composition', () => {
  it('keeps one page-level heading while queue children retain subordinate titles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [], nextCursor: null } }), { headers: { 'content-type': 'application/json' } })));
    render(<NextIntlClientProvider locale="en" messages={messages}><GradingOperations {...props}/></NextIntlClientProvider>);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Grading queues' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Submission queue' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Exams' }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Exam attempts' })).toBeInTheDocument();
  });

  it('keeps the child workspace page heading when rendered standalone', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [], nextCursor: null } }), { headers: { 'content-type': 'application/json' } })));
    render(<NextIntlClientProvider locale="en" messages={messages}><SubmissionsWorkspace branches={props.branches} courses={props.courses} assignments={[]} canGrade/></NextIntlClientProvider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Submission queue' })).toBeInTheDocument();
  });
});

describe('grading queue list', () => {
  const queueRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, userId: `learner-${id}`, learnerName: `Learner ${id}`, branchId: 'branch-a',
    courseVersionId: '11111111-1111-4111-8111-111111111111', itemId: 'lesson-one', blockId: null,
    assignmentId: 'lesson-one', attemptNo: 1, status: 'submitted', submittedAt: '2026-09-03T04:00:00.000Z',
    payload: { text: `Response from ${id}` }, files: [], ...overrides,
  });
  const respond = (items: unknown[]) => new Response(JSON.stringify({ data: { items, nextCursor: null } }), { headers: { 'content-type': 'application/json' } });

  it('offers a Waiting status that asks the queue for pending submissions', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respond([]));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NextIntlClientProvider locale="en" messages={messages}><SubmissionsWorkspace branches={props.branches} courses={props.courses} assignments={[]} canGrade embedded/></NextIntlClientProvider>);

    const status = screen.getByLabelText('Status');
    expect(screen.getByRole('option', { name: 'Waiting' })).toHaveValue('pending');
    await user.selectOptions(status, 'pending');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=pending'))).toBe(true));
    expect(window.location.search).toContain('status=pending');
  });

  it('restores a Waiting filter from the URL', async () => {
    window.history.replaceState({}, '', '/grading/queue?status=pending');
    const fetchMock = vi.fn().mockImplementation(async () => respond([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<NextIntlClientProvider locale="en" messages={messages}><SubmissionsWorkspace branches={props.branches} courses={props.courses} assignments={[]} canGrade embedded/></NextIntlClientProvider>);

    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('pending'));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('status=pending'));
  });

  it('names rows with resolved titles when assignment metadata has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => respond([queueRow('one')])));
    render(<NextIntlClientProvider locale="en" messages={messages}><SubmissionsWorkspace
      branches={props.branches} courses={props.courses} assignments={[]} canGrade embedded
      titles={{ '11111111-1111-4111-8111-111111111111': { courseTitle: 'Design thinking', items: { 'lesson-one': 'Assignment one' } } }}
    /></NextIntlClientProvider>);

    expect(await screen.findByText('Design thinking')).toBeInTheDocument();
    expect(screen.getByText('Assignment one')).toBeInTheDocument();
    expect(screen.queryByText('11111111-1111-4111-8111-111111111111')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Learner one/ }).querySelector('[data-tone]')).toHaveAttribute('data-tone', 'warning');
  });

  it('previews a clicked row beside the list with a link to the grading workbench', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => respond([queueRow('one'), queueRow('two', { payload: { text: 'Second response' } })])));
    const user = userEvent.setup();
    render(<NextIntlClientProvider locale="en" messages={messages}><SubmissionsWorkspace branches={props.branches} courses={props.courses} assignments={[]} canGrade embedded/></NextIntlClientProvider>);

    await user.click(await screen.findByText('Learner two'));
    const preview = screen.getByRole('complementary', { name: 'Learner two' });
    expect(within(preview).getByText('Second response')).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: 'Open grading workbench' })).toHaveAttribute('href', expect.stringContaining('/grading/assignments/two?branchId=branch-a'));
    expect(screen.getByRole('button', { name: 'Preview Learner two' })).toHaveAttribute('aria-pressed', 'true');
    // The row's own Grade link still navigates instead of previewing.
    expect(screen.getAllByRole('link', { name: 'Grade' })).toHaveLength(2);

    await user.click(within(preview).getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});

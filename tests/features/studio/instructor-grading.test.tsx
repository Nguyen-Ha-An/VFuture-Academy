// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({
  ROLE_PERMISSIONS: {
    contributor: ['resource.edit'],
    editor: ['course.read'],
    instructor: ['course.read', 'submission.grade', 'exam.release'],
    branch_lead: ['course.read', 'submission.grade', 'exam.release'],
    admin: ['course.read', 'submission.grade', 'exam.release'],
  },
  hasGlobalPermission: (actor: { roles: Array<{ role: string; branchId: string | null }> }, permission: string) =>
    actor.roles.some(({ role, branchId }) => branchId === null
      && role === 'admin'
      && ['submission.grade', 'exam.release'].includes(permission)),
  allowedBranchIds: (actor: { roles: Array<{ role: string; branchId: string | null }> }, permission: string) =>
    actor.roles.flatMap(({ role, branchId }) => branchId !== null
      && role === 'instructor'
      && ['submission.grade', 'exam.release'].includes(permission) ? [branchId] : []),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'scoreSummary') return `${values?.total} / ${values?.max}`;
    if (key === 'releaseSummary') return `released ${values?.released}`;
    if (key === 'skippedForbidden') return `forbidden ${values?.count}`;
    if (key === 'skippedUnassigned') return `unassigned ${values?.count}`;
    if (key === 'skippedAlreadyReleased') return `already released ${values?.count}`;
    if (key === 'skippedNotReleasable') return `not releasable ${values?.count}`;
    if (key === 'loadMore') return 'Load more';
    if (key === 'gradingDraftNotice') return 'Private grading draft';
    if (key === 'releasedGradeNotice') return 'Released grade';
    if (key === 'staleReloaded') return 'Submission changed; queue refreshed.';
    return key;
  },
}));

import {
  buildInstructorMetadata,
  deriveBranchOptions,
} from '@/features/instructor-grading/server-data';
import {
  RubricScoreEditor,
  SubmissionResponse,
  SubmissionsWorkspace,
  computeRubricTotal,
  normalizeSubmissionRows,
} from '@/features/instructor-grading/SubmissionsWorkspace';
import {
  ExamAttemptsTable,
  ExamsWorkspace,
  ManualAnswer,
  ReleaseExamDialog,
} from '@/features/instructor-grading/ExamsWorkspace';
import type {
  BranchOption,
  ExamAttempt,
  SubmissionQueueItem,
  SubmissionStatus,
} from '@/features/instructor-grading/types';
import { SubmissionsTable } from '@/features/instructor-grading/SubmissionsWorkspace';
import { WorkspaceApiError } from '@/features/studio/ui/client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const branches: BranchOption[] = [
  { id: 'ans', name: 'ANS' },
  { id: 'vinsmc', name: 'VinSMC' },
  { id: 'dewey', name: 'Dewey Schools' },
];

describe('instructor grading rubric', () => {
  const rubric = {
    criteria: [
      {
        id: 'quality',
        name: 'Quality',
        maxPoints: 4,
        levels: [
          { points: 0, label: 'Missing' },
          { points: 2, label: 'Developing' },
          { points: 4, label: 'Strong' },
        ],
      },
      { id: 'impact', name: 'Impact', maxPoints: 4 },
    ],
  };

  it('computes a running total independently from the rubric maximum', () => {
    expect(computeRubricTotal(rubric, { quality: 2, impact: 3.5 })).toEqual({
      total: 5.5,
      max: 8,
    });
  });

  it('updates the rendered total from a labelled level radio group and numeric score', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [scores, setScores] = useState<Record<string, number>>({});
      return <RubricScoreEditor rubric={rubric} scores={scores} onChange={setScores} />;
    }
    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Strong' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Impact' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Impact' }), '3.5');

    expect(screen.getByText('7.5 / 8')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Quality' })).toBeInTheDocument();
  });

  it('gives duplicate-point rubric levels unique criterion-and-index ids', () => {
    render(<RubricScoreEditor rubric={{
      criteria: [{
        id: 'quality', name: 'Quality', maxPoints: 4,
        levels: [{ points: 2, label: 'Developing' }, { points: 2, label: 'Alternate' }],
      }],
    }} scores={{}} onChange={vi.fn()} />);

    const ids = screen.getAllByRole('radio').map((radio) => radio.id);
    expect(ids).toEqual(['rubric-quality-0', 'rubric-quality-1']);
  });
});

describe('instructor branch scope', () => {
  it('derives only branches where the actor holds the requested grading permission', () => {
    const actor = {
      userId: 'instructor-1',
      roles: [
        { role: 'instructor' as const, branchId: 'vinsmc' },
        { role: 'contributor' as const, branchId: 'ans' },
      ],
    };

    expect(deriveBranchOptions(actor, branches, 'submission.grade')).toEqual([
      { id: 'vinsmc', name: 'VinSMC' },
    ]);
  });

  it('offers every branch to a globally scoped administrator', () => {
    const actor = {
      userId: 'admin-1',
      roles: [{ role: 'admin' as const, branchId: null }],
    };

    expect(deriveBranchOptions(actor, branches, 'exam.release')).toEqual(branches);
  });
});

describe('instructor grading metadata', () => {
  it('keeps pinned version rubrics and exam selectors aligned with localized titles', () => {
    const metadata = buildInstructorMetadata('en', {
      versions: [{ id: 'version-1', course_id: 'course-one', version: 3 }],
      outlines: [{
        version_id: 'version-1',
        course_id: 'course-one',
        meta: { title: { vi: 'Khóa một', en: 'Course One' } },
        outline: { modules: [{ items: [{ id: 'lesson-one', title: { en: 'Lesson One' } }, { id: 'exam-one', title: { en: 'Exam One' } }] }] },
      }],
      items: [
        {
          version_id: 'version-1', item_id: 'lesson-one', kind: 'lesson',
          grading: { rubrics: { 'assignment-block': { criteria: [{ id: 'quality', name: { en: 'Quality' }, maxPoints: 4 }] } } },
        },
        { version_id: 'version-1', item_id: 'exam-one', kind: 'exam', grading: { rubrics: {} } },
      ],
      renders: [{ version_id: 'version-1', item_id: 'exam-one', locale: 'en', payload: { title: 'Final Exam' } }],
    });

    expect(metadata.courses).toEqual([{ id: 'course-one', title: 'Course One' }]);
    expect(metadata.assignments[0]).toMatchObject({
      courseVersionId: 'version-1', version: 3, itemId: 'lesson-one', assignmentId: 'assignment-block', itemTitle: 'Lesson One',
      rubric: { criteria: [{ id: 'quality', maxPoints: 4 }] },
    });
    expect(metadata.exams).toEqual([expect.objectContaining({
      courseId: 'course-one', version: 3, itemId: 'exam-one', itemTitle: 'Final Exam',
    })]);
  });

  it('uses readable localized labels when authored item titles are missing', () => {
    const rows = {
      versions: [{ id: 'version-1', course_id: 'course-one', version: 3 }],
      outlines: [{ version_id: 'version-1', course_id: 'course-one', meta: { title: { en: 'Course One' } }, outline: { modules: [] } }],
      items: [{ version_id: 'version-1', item_id: 'opaque-item-id', kind: 'assignment', grading: {} }],
      renders: [],
    };

    expect(buildInstructorMetadata('en', rows).assignments[0].itemTitle).toBe('Untitled item');
    expect(buildInstructorMetadata('vi', rows).assignments[0].itemTitle).toBe('Mục chưa có tiêu đề');
  });

  it('normalizes the queue response against the exact pinned assignment rubric', () => {
    const assignments = [{
      courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
      itemId: 'lesson-one', itemTitle: 'Lesson One', assignmentId: 'assignment-block',
      rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] },
    }];
    const result = normalizeSubmissionRows([{
      id: 'submission-1', user_id: 'learner-1', course_version_id: 'version-1', item_id: 'lesson-one',
      block_id: 'assignment-block', attempt_no: 2, status: 'submitted', submitted_at: '2026-09-03T04:00:00.000Z',
      payload: { text: 'Work' }, profiles: { branch_id: 'vinsmc', display_name: 'Learner One', handle: 'learner' },
      submission_files: [{ asset_id: 'asset-1', name: 'work.pdf', size_bytes: 200, mime: 'application/pdf' }],
      grades: [{
        rubric_scores: { quality: 3 }, feedback: { en: 'Existing feedback', vi: 'Pháº£n há»“i cÅ©' },
        decision: 'changes_requested', released: true, graded_at: '2026-09-03T05:00:00.000Z',
        total_points: 3, max_points: 4,
      }],
    }], assignments);

    expect(result).toEqual([expect.objectContaining({
      id: 'submission-1', learnerName: 'Learner One', courseTitle: 'Course One', itemTitle: 'Lesson One',
      assignmentId: 'assignment-block', attemptNo: 2, rubric: assignments[0].rubric,
      files: [{ assetId: 'asset-1', name: 'work.pdf', size: 200, mime: 'application/pdf' }],
      grade: {
        rubricScores: { quality: 3 }, feedback: { en: 'Existing feedback', vi: 'Pháº£n há»“i cÅ©' },
        decision: 'changes_requested', released: true, totalPoints: 3, maxPoints: 4,
        gradedAt: '2026-09-03T05:00:00.000Z',
      },
    })]);
  });
});

describe('learner answer rendering', () => {
  function question(answer: unknown, type = 'upload_answer') {
    return {
      questionId: `question-${Math.random()}`,
      type,
      answer,
      maxPoints: 5,
      points: null,
      feedback: null,
    };
  }

  it('renders primitive upload asset ids through the authenticated media redirect', () => {
    render(<ManualAnswer question={question(['asset-upload-1'])} />);

    expect(screen.getByRole('link', { name: /asset-upload-1/ })).toHaveAttribute(
      'href',
      '/api/v1/media/asset-upload-1',
    );
  });

  it('renders primitive links only when they use https', () => {
    render(<ManualAnswer question={question(['https://example.com/work', 'http://example.com/unsafe'])} />);

    expect(screen.getByRole('link', { name: 'https://example.com/work' })).toHaveAttribute('href', 'https://example.com/work');
    expect(screen.queryByRole('link', { name: 'http://example.com/unsafe' })).not.toBeInTheDocument();
  });

  it('renders text answers and the assignment-style upload object', () => {
    const { rerender } = render(<ManualAnswer question={question('A considered response', 'essay')} />);
    expect(screen.getByText('A considered response')).toBeInTheDocument();

    rerender(<ManualAnswer question={question({
      text: 'Supporting note',
      links: [{ url: 'https://example.com/reference', label: 'Reference' }],
      files: [{ assetId: 'asset-upload-2', name: 'evidence.pdf' }],
    })} />);
    expect(screen.getByText('Supporting note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reference' })).toHaveAttribute('href', 'https://example.com/reference');
    expect(screen.getByRole('link', { name: /evidence.pdf/ })).toHaveAttribute('href', '/api/v1/media/asset-upload-2');
  });

  it('falls back to JSON whenever no recognized answer branch renders output', () => {
    const { rerender } = render(<ManualAnswer question={question({
      files: [42],
      links: ['javascript:alert(1)'],
      unexpected: { nested: true },
    })} />);

    expect(screen.getByText(/"unexpected": \{/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    rerender(<ManualAnswer question={question('', 'essay')} />);
    expect(screen.getByText('""')).toBeInTheDocument();
  });

  it('renders submitted text on a fresh grading entry without visiting a lesson first', () => {
    const item: SubmissionQueueItem = {
      id: 'submission-text', userId: 'learner-1', learnerName: 'Learner One', branchId: 'vinsmc',
      courseVersionId: 'version-1', courseId: 'course-one', courseTitle: 'Course One',
      itemId: 'assignment-one', itemTitle: 'Assignment One', assignmentId: 'assignment-one',
      attemptNo: 1, status: 'submitted', submittedAt: '2026-09-03T04:00:00.000Z',
      payload: { text: 'The learner submitted this evidence.' }, files: [], rubric: { criteria: [] },
    };
    render(<SubmissionResponse item={item} />);
    expect(screen.getByText('The learner submitted this evidence.')).toBeVisible();
    expect(document.querySelector('[data-unavailable]')).toBeNull();
  });

  it('guards assignment-submission learner URLs again at render time', () => {
    const item: SubmissionQueueItem = {
      id: 'submission-links', userId: 'learner-1', learnerName: 'Learner One', branchId: 'vinsmc',
      courseVersionId: 'version-1', courseId: 'course-one', courseTitle: 'Course One',
      itemId: 'assignment-one', itemTitle: 'Assignment One', assignmentId: 'assignment-one',
      attemptNo: 1, status: 'submitted', submittedAt: '2026-09-03T04:00:00.000Z',
      payload: { links: [{ url: 'https://example.com/safe' }, { url: 'javascript:alert(1)' }] },
      files: [], rubric: { criteria: [] },
    };
    render(<SubmissionResponse item={item} />);

    expect(screen.getByRole('link', { name: 'https://example.com/safe' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).not.toBeInTheDocument();
  });
});

describe('existing grade normalization', () => {
  it('projects the latest stored grade onto the queue row the workbench opens', () => {
    // The queue no longer grades inline; it must still surface the durable grade state that the
    // full-page workbench then loads, including a released grade the workbench locks on.
    const [released] = normalizeSubmissionRows([{
      id: 'submission-regrade', user_id: 'learner-1', learnerName: 'Learner One', branchId: 'vinsmc',
      course_version_id: 'version-1', item_id: 'assignment-one', assignmentId: 'assignment-one',
      attempt_no: 1, status: 'changes_requested', submitted_at: '2026-09-03T04:00:00.000Z',
      payload: { text: 'Revised work' }, files: [],
      grades: [{
        rubric_scores: { quality: 3 }, feedback: { en: 'Existing feedback' },
        decision: 'changes_requested', released: true, graded_at: '2026-09-03T05:00:00.000Z',
      }],
    }], []);
    expect(released?.grade).toMatchObject({ rubricScores: { quality: 3 }, decision: 'changes_requested', released: true });

    const [draft] = normalizeSubmissionRows([{
      id: 'submission-draft', user_id: 'learner-1', learnerName: 'Learner One', branchId: 'vinsmc',
      course_version_id: 'version-1', item_id: 'assignment-one', assignmentId: 'assignment-one',
      attempt_no: 1, status: 'in_review', submitted_at: '2026-09-03T04:00:00.000Z',
      payload: { text: 'Work' }, files: [],
      grades: [{
        rubric_scores: { quality: 2 }, feedback: 'Draft feedback', decision: 'approved',
        released: false, total_points: 2, max_points: 4, graded_at: '2026-09-03T05:00:00.000Z',
      }],
    }], []);
    expect(draft?.grade).toMatchObject({ released: false, totalPoints: 2, maxPoints: 4 });
  });
});

describe('paged submission queue', () => {
  const assignments = [{
    courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
    itemId: 'lesson-one', itemTitle: 'Lesson One', assignmentId: 'assignment-block',
    rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] },
  }];
  const queueSubmission = (id: string, status: SubmissionStatus = 'submitted') => ({
    id, userId: `learner-${id}`, learnerName: `Learner ${id}`, branchId: 'vinsmc',
    courseVersionId: 'version-1', itemId: 'lesson-one', blockId: 'assignment-block',
    assignmentId: 'assignment-block', attemptNo: 1, status, submittedAt: '2026-09-03T04:00:00.000Z',
    payload: { text: `Work ${id}` }, files: [],
  });

  function renderWorkspace() {
    return render(<SubmissionsWorkspace
      branches={[{ id: 'vinsmc', name: 'VinSMC' }]}
      courses={[{ id: 'course-one', title: 'Course One' }]}
      assignments={assignments}
      canGrade
    />);
  }

  it('filters by assignment and loads cursor pages without duplicate rows', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { items: [queueSubmission('one')], nextCursor: 'cursor-one' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { items: [queueSubmission('one'), queueSubmission('two')], nextCursor: null },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { items: [queueSubmission('two')], nextCursor: null },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText('Learner one')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Learner two')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'gradeAction' })).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=cursor-one');

    await user.selectOptions(screen.getByLabelText('filters.assignment'), 'assignment-block');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('assignmentId=assignment-block');
  });

  it('resets load-more ownership when filters change and ignores the stale cursor response', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const oldPage = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const newPage = new Promise<Response>((resolve) => { resolveNew = resolve; });
    const response = (items: unknown[], nextCursor: string | null) => new Response(JSON.stringify({ data: { items, nextCursor } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([queueSubmission('initial')], 'cursor-old'))
      .mockImplementationOnce(() => oldPage)
      .mockResolvedValueOnce(response([queueSubmission('filtered', 'in_review')], 'cursor-new'))
      .mockImplementationOnce(() => newPage);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await user.selectOptions(screen.getByLabelText('filters.status'), 'in_review');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Learner filtered')).toBeInTheDocument();
    const loadFiltered = screen.getByRole('button', { name: 'Load more' });
    expect(loadFiltered).toBeEnabled();
    await user.click(loadFiltered);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    resolveOld(response([queueSubmission('stale')], null));
    await act(async () => oldPage);
    expect(screen.getByRole('button', { name: 'loadingMore' })).toBeDisabled();
    expect(screen.queryByText('Learner stale')).not.toBeInTheDocument();

    resolveNew(response([queueSubmission('new', 'in_review')], null));
    await act(async () => newPage);
    expect(await screen.findByText('Learner new')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('guards duplicate load-more requests synchronously', async () => {
    const pending = new Promise<Response>(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { items: [queueSubmission('one')], nextCursor: 'cursor-one' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockImplementation(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace();

    const button = await screen.findByRole('button', { name: 'Load more' });
    act(() => {
      button.click();
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('links an assignment row to its canonical workbench while retaining active filters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { items: [queueSubmission('durable', 'in_review')], nextCursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    renderWorkspace();
    const link = await screen.findByRole('link', { name: 'gradeAction' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/grading/assignments/durable?branchId=vinsmc'));
    expect(link).toHaveAttribute('href', expect.stringContaining('back=%2Fgrading%2Fqueue'));
  });

  it('separates result availability from answer-key release in the attempts table', () => {
    const base = { userId: 'learner', learnerName: 'Learner', courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'branch-a', attemptNo: 1, late: false, startedAt: '2026-09-07T00:00:00Z', deadlineAt: null, submittedAt: '2026-09-07T00:01:00Z', points: null, maxPoints: null, percent: null, integrityEventCount: 0, pendingManualQuestions: [] };
    const attempts = [
      { ...base, attemptId: 'grading', status: 'pending_manual', releasedAt: null, resultAvailableAt: null },
      { ...base, attemptId: 'complete', status: 'graded', releasedAt: null, resultAvailableAt: '2026-09-07T04:10:00.000Z' },
      { ...base, attemptId: 'legacy', status: 'graded', releasedAt: null, resultAvailableAt: null },
      { ...base, attemptId: 'released', status: 'graded', releasedAt: '2026-09-01T00:00:00.000Z', resultAvailableAt: null },
    ] satisfies ExamAttempt[];
    render(<ExamAttemptsTable attempts={attempts} canGrade={false} />);
    expect(screen.getByText('Grading')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    // Neither historical row has an availability marker, but only one of them is actually hidden:
    // the released one already shows its score to the learner through the legacy path.
    expect(screen.getByText('Awaiting legacy release')).toBeInTheDocument();
    expect(screen.getByText('Released (legacy)')).toBeInTheDocument();
    expect(screen.queryByText('Not available')).not.toBeInTheDocument();
    expect(screen.getAllByText('Answer key released')).toHaveLength(1);
  });

  it('links an exam row to its canonical workbench with an assessment back URL', () => {
    const attempt = { attemptId: 'attempt-1', userId: 'learner', learnerName: 'Learner', courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'branch-a', attemptNo: 1, status: 'pending_manual', late: false, startedAt: '2026-09-07T00:00:00Z', deadlineAt: null, submittedAt: '2026-09-07T00:01:00Z', points: null, maxPoints: null, percent: null, releasedAt: null, integrityEventCount: 0, pendingManualQuestions: [] } satisfies ExamAttempt;
    render(<ExamAttemptsTable attempts={[attempt]} canGrade detailHref={(entry) => `/grading/exams/${entry.attemptId}?branchId=branch-a&back=%2Fgrading%2Fassessments`} />);
    expect(screen.getByRole('link', { name: 'manualGradeAction' })).toHaveAttribute('href', '/grading/exams/attempt-1?branchId=branch-a&back=%2Fgrading%2Fassessments');
  });
});

describe('permission-gated instructor actions', () => {
  const submission: SubmissionQueueItem = {
    id: 'submission-1',
    userId: 'learner-1',
    learnerName: 'Learner One',
    branchId: 'vinsmc',
    courseVersionId: 'version-1',
    courseId: 'course-one',
    courseTitle: 'Course One',
    itemId: 'assignment-one',
    itemTitle: 'Assignment One',
    assignmentId: 'assignment-one',
    attemptNo: 1,
    status: 'submitted',
    submittedAt: '2026-09-03T04:00:00.000Z',
    payload: { text: 'My work' },
    files: [],
    rubric: { criteria: [] },
  };
  const attempt: ExamAttempt = {
    attemptId: 'attempt-1',
    userId: 'learner-1',
    learnerName: 'learner-1',
    courseVersionId: 'version-1',
    itemId: 'exam-one',
    branchId: 'vinsmc',
    attemptNo: 1,
    status: 'pending_manual',
    late: false,
    startedAt: '2026-09-03T03:00:00.000Z',
    deadlineAt: null,
    submittedAt: '2026-09-03T04:00:00.000Z',
    points: 2,
    maxPoints: 4,
    percent: 50,
    releasedAt: null,
    integrityEventCount: 2,
    pendingManualQuestions: [],
  };

  it('hides submission grading controls without submission.grade', () => {
    render(<SubmissionsTable items={[submission]} canGrade={false} onGrade={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'gradeAction' })).not.toBeInTheDocument();
  });

  it('hides manual grading and release controls without their permissions', () => {
    render(
      <>
        <ExamAttemptsTable attempts={[attempt]} canGrade={false} onGrade={vi.fn()} />
        <ReleaseExamDialog canRelease={false} hasReleasableAttempts={false} onRelease={vi.fn()} />
      </>,
    );

    expect(screen.queryByRole('button', { name: 'manualGradeAction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'releaseAction' })).not.toBeInTheDocument();
  });
});

describe('exam release confirmation', () => {
  it('shows every skipped count returned by the release endpoint', async () => {
    const user = userEvent.setup();
    const onRelease = vi.fn().mockResolvedValue({
      released: [{ attemptId: 'attempt-1', releasedAt: '2026-09-03T05:00:00.000Z' }],
      skipped: { forbidden: 2, unassigned: 3, alreadyReleased: ['attempt-4'], notReleasable: ['attempt-2', 'attempt-3'] },
    });
    render(<ReleaseExamDialog canRelease hasReleasableAttempts onRelease={onRelease} />);

    await user.click(screen.getByRole('button', { name: 'releaseAction' }));
    expect(screen.getByRole('dialog', { name: 'releaseTitle' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'confirmRelease' }));

    expect(await screen.findByText('released 1')).toBeInTheDocument();
    expect(screen.getByText('forbidden 2')).toBeInTheDocument();
    expect(screen.getByText('unassigned 3')).toBeInTheDocument();
    expect(screen.getByText('already released 1')).toBeInTheDocument();
    expect(screen.getByText('not releasable 2')).toBeInTheDocument();
  });

  it('disables release until the selected queue contains a graded unreleased attempt', () => {
    render(<ReleaseExamDialog canRelease hasReleasableAttempts={false} onRelease={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'releaseAction' })).toBeDisabled();
  });

  it('derives release eligibility from the selected queue instead of permission alone', async () => {
    const pending: ExamAttempt = {
      attemptId: 'attempt-pending', userId: 'learner-1', learnerName: 'Learner One',
      courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'vinsmc', attemptNo: 1,
      status: 'pending_manual', late: false, startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null,
      submittedAt: '2026-09-03T04:00:00.000Z', points: 2, maxPoints: 4, percent: 50,
      releasedAt: null, integrityEventCount: 0, pendingManualQuestions: [questionFixture()],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { attempts: [pending], skipped: { unassigned: 0 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    render(<ExamsWorkspace
      branches={[{ id: 'vinsmc', name: 'VinSMC' }]}
      courses={[{ id: 'course-one', title: 'Course One' }]}
      exams={[{
        courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
        version: 1, itemId: 'exam-one', itemTitle: 'Exam One',
      }]}
      gradingBranchIds={['vinsmc']}
      canRelease
    />);

    expect(await screen.findByText('Learner One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'releaseAction' })).toBeDisabled();
  });

  it('uses the workspace API error code when release fails', async () => {
    const user = userEvent.setup();
    render(<ReleaseExamDialog
      canRelease
      hasReleasableAttempts
      onRelease={vi.fn().mockRejectedValue(new WorkspaceApiError('RELEASE_DENIED', 'denied'))}
    />);

    await user.click(screen.getByRole('button', { name: 'releaseAction' }));
    await user.click(screen.getByRole('button', { name: 'confirmRelease' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('releaseError (RELEASE_DENIED)');
  });

  it('clears a previous release error when the confirmation is reopened', async () => {
    const user = userEvent.setup();
    render(<ReleaseExamDialog
      canRelease
      hasReleasableAttempts
      onRelease={vi.fn().mockRejectedValue(new WorkspaceApiError('RELEASE_DENIED', 'denied'))}
    />);

    await user.click(screen.getByRole('button', { name: 'releaseAction' }));
    await user.click(screen.getByRole('button', { name: 'confirmRelease' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close' }));
    await user.click(screen.getByRole('button', { name: 'releaseAction' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('exam grading branch scope', () => {
  it('clears the previous branch attempts and release eligibility while the next branch loads', async () => {
    const attempt: ExamAttempt = {
      attemptId: 'attempt-a', userId: 'learner-1', learnerName: 'Learner in A',
      courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'branch-a', attemptNo: 1,
      status: 'graded', late: false, startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null,
      submittedAt: '2026-09-03T04:00:00.000Z', points: 4, maxPoints: 4, percent: 100,
      releasedAt: null, resultAvailableAt: '2026-09-03T05:00:00.000Z', integrityEventCount: 0,
      pendingManualQuestions: [],
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => url.includes('branchId=branch-a')
      ? Promise.resolve(new Response(JSON.stringify({
        data: { attempts: [attempt], skipped: { unassigned: 0 } },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      : new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ExamsWorkspace
      branches={[{ id: 'branch-a', name: 'Branch A' }, { id: 'branch-b', name: 'Branch B' }]}
      courses={[{ id: 'course-one', title: 'Course One' }]}
      exams={[{
        courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
        version: 1, itemId: 'exam-one', itemTitle: 'Exam One',
      }]}
      gradingBranchIds={['branch-a', 'branch-b']}
      releaseBranchIds={['branch-a', 'branch-b']}
      canRelease
    />);

    expect(await screen.findByText('Learner in A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'releaseAction' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('filters.branch'), 'branch-b');
    expect(screen.queryByText('Learner in A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'releaseAction' })).toBeDisabled();
  });

  it('loads attempts for a grader who cannot release them', async () => {
    const attempt: ExamAttempt = {
      attemptId: 'attempt-1', userId: 'learner-1', learnerName: 'Learner One',
      courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'branch-a', attemptNo: 1,
      status: 'pending_manual', late: false, startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null,
      submittedAt: '2026-09-03T04:00:00.000Z', points: 0, maxPoints: 5, percent: 0,
      releasedAt: null, integrityEventCount: 0,
      pendingManualQuestions: [questionFixture()],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { attempts: [attempt], skipped: { unassigned: 0 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ExamsWorkspace
      branches={[{ id: 'branch-a', name: 'Branch A' }]}
      courses={[{ id: 'course-one', title: 'Course One' }]}
      exams={[{
        courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
        version: 1, itemId: 'exam-one', itemTitle: 'Exam One',
      }]}
      gradingBranchIds={['branch-a']}
      releaseBranchIds={[]}
      canRelease={false}
    />);

    expect(await screen.findByRole('link', { name: 'manualGradeAction' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'releaseAction' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('branchId=branch-a'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('recomputes manual-grade visibility when the selected branch changes', async () => {
    const attempt: ExamAttempt = {
      attemptId: 'attempt-1', userId: 'learner-1', learnerName: 'Learner One',
      courseVersionId: 'version-1', itemId: 'exam-one', branchId: 'branch-a', attemptNo: 1,
      status: 'pending_manual', late: false, startedAt: '2026-09-03T03:00:00.000Z', deadlineAt: null,
      submittedAt: '2026-09-03T04:00:00.000Z', points: 0, maxPoints: 5, percent: 0,
      releasedAt: null, integrityEventCount: 0,
      pendingManualQuestions: [questionFixture()],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { attempts: [attempt], skipped: { unassigned: 0 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ExamsWorkspace
      branches={[{ id: 'branch-a', name: 'Branch A' }, { id: 'branch-b', name: 'Branch B' }]}
      courses={[{ id: 'course-one', title: 'Course One' }]}
      exams={[{
        courseId: 'course-one', courseTitle: 'Course One', courseVersionId: 'version-1',
        version: 1, itemId: 'exam-one', itemTitle: 'Exam One',
      }]}
      gradingBranchIds={['branch-a']}
      canRelease
    />);

    expect(await screen.findByRole('link', { name: 'manualGradeAction' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('filters.branch'), 'branch-b');
    expect(screen.queryByRole('link', { name: 'manualGradeAction' })).not.toBeInTheDocument();
  });
});

function questionFixture() {
  return {
    questionId: 'section/essay', type: 'essay', answer: 'Answer', maxPoints: 5, points: null, feedback: null,
  };
}

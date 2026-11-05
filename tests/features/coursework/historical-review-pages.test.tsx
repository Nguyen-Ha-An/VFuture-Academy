import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ assignment: vi.fn(), quiz: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'history-owner' })) }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'en') }));
vi.mock('@/features/submissions/history', () => ({ getAssignmentHistoricalReview: mocks.assignment }));
vi.mock('@/features/quizzes/history', () => ({ getQuizHistoricalReview: mocks.quiz }));
import AssignmentPage from '@/app/app/courses/[courseId]/items/[itemId]/assignment-reviews/[submissionId]/page';
import QuizPage from '@/app/app/courses/[courseId]/items/[itemId]/quiz-reviews/[attemptId]/page';

const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignment.mockResolvedValue({ courseId: 'course-owned', courseVersionId: 'original-pin', itemId: 'old-lesson', blockId: 'old-block',
    courseTitle: 'Original course title', locale: 'en', assignment: { title: 'Original assignment' },
    submission: { submissionId: id, attemptNo: 1, status: 'changes_requested', submittedAt: '2026-10-01T00:00:00Z', files: [],
      payload: { text: 'Immutable submitted work' }, grade: { totalPoints: 6, maxPoints: 10, feedback: 'Released original feedback' } } });
  mocks.quiz.mockResolvedValue({ courseId: 'course-owned', courseVersionId: 'original-pin', itemId: 'old-lesson', blockId: 'old-quiz',
    courseTitle: 'Original course title', locale: 'en', quiz: { title: 'Original quiz', questions: [{ id: 'q', stem: { blocks: [{ type: 'paragraph', content: [{ text: 'Original question prompt' }] }] } }] },
    attempt: { attemptId: id, attemptNo: 1, submittedAt: '2026-10-01T00:00:00Z', points: 1, maxPoints: 2, percent: 50, passed: false,
      answers: { q: 'Original saved answer' }, results: [] } });
});
describe('dedicated historical record consumers', () => {
  it('binds the selected assignment and renders saved payload/released feedback without a writable session', async () => {
    const html = renderToStaticMarkup(await AssignmentPage({ params: Promise.resolve({ courseId: 'course-owned', itemId: 'old-lesson', submissionId: id }) }));
    expect(mocks.assignment).toHaveBeenCalledWith({ userId: 'history-owner', roles: [] }, { courseId: 'course-owned', itemId: 'old-lesson', submissionId: id }, 'en');
    expect(html).toContain('Immutable submitted work'); expect(html).toContain('Released original feedback'); expect(html).toContain('Original assignment');
    expect(html).not.toMatch(/<form|<input|<textarea|<button/);
  });
  it('binds the selected quiz record and renders pinned questions with recorded answers without restoring a live player', async () => {
    const html = renderToStaticMarkup(await QuizPage({ params: Promise.resolve({ courseId: 'course-owned', itemId: 'old-lesson', attemptId: id }) }));
    expect(mocks.quiz).toHaveBeenCalledWith({ userId: 'history-owner', roles: [] }, { courseId: 'course-owned', itemId: 'old-lesson', attemptId: id }, 'en');
    expect(html).toContain('Original question prompt'); expect(html).toContain('Original saved answer'); expect(html).toContain('Original quiz');
    expect(html).not.toMatch(/<form|<input|<textarea|<button/);
  });
});

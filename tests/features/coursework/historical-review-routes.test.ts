import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), assignment: vi.fn(), quiz: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.user }));
vi.mock('@/features/submissions/history', () => ({ getAssignmentHistoricalReview: mocks.assignment }));
vi.mock('@/features/quizzes/history', () => ({ getQuizHistoricalReview: mocks.quiz }));
import { ApiError } from '@/lib/api';
import { GET as assignment } from '@/app/api/v1/assignments/submissions/[submissionId]/historical-review/route';
import { GET as quiz } from '@/app/api/v1/quizzes/attempts/[attemptId]/historical-review/route';

const recordId = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 'history-owner' });
  mocks.assignment.mockResolvedValue({ submission: { submissionId: recordId } });
  mocks.quiz.mockResolvedValue({ attempt: { attemptId: recordId } });
});
describe('dedicated owner history GET APIs', () => {
  it('binds each selected record and exact course/item locator to the authenticated owner without caching', async () => {
    for (const [kind, handler, reader] of [['assignment', assignment, mocks.assignment], ['quiz', quiz, mocks.quiz]] as const) {
      const params = kind === 'assignment' ? { submissionId: recordId } : { attemptId: recordId };
      const response = await handler(new Request('https://academy.test/history?courseId=course-owned&itemId=old-lesson&locale=en'), { params: Promise.resolve(params) });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(reader).toHaveBeenCalledWith({ userId: 'history-owner', roles: [] }, { courseId: 'course-owned', itemId: 'old-lesson',
        ...(kind === 'assignment' ? { submissionId: recordId } : { attemptId: recordId }) }, 'en');
    }
  });
  it('rejects actor/school/pin injection and unauthenticated reads before the history reader runs', async () => {
    const forged = await quiz(new Request('https://academy.test/history?courseId=course-owned&itemId=old-lesson&userId=someone-else&courseVersionId=new-pin'),
      { params: Promise.resolve({ attemptId: recordId }) });
    expect(forged.status).toBe(400); expect(mocks.quiz).not.toHaveBeenCalled();
    mocks.user.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sign in'));
    expect((await assignment(new Request('https://academy.test/history'), { params: Promise.resolve({ submissionId: recordId }) })).status).toBe(401);
    expect(mocks.assignment).not.toHaveBeenCalled();
  });
});

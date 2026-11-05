import { describe, expect, it } from 'vitest';
import { createHistoricalReviewRuntime } from '@/features/exams/ui/HistoricalExamReview';
const context={attemptId:'00000000-0000-4000-8000-000000000003',courseId:'course-one',itemId:'exam-one'};

describe('historical exam review runtime', () => {
  it('preserves authorized asset resolution and authored URL media', () => {
    const runtime = createHistoricalReviewRuntime('vi',context);
    expect(runtime.locale).toBe('vi');
    expect(runtime.resolveMedia({ assetId: 'asset/with spaces' })).toBe('/api/v1/media/asset%2Fwith%20spaces?historicalExamAttemptId=00000000-0000-4000-8000-000000000003&courseId=course-one&itemId=exam-one');
    expect(runtime.resolveMedia({ url: 'https://example.com/diagram.png' })).toBe('https://example.com/diagram.png');
  });

  it('cannot create answers, submissions or uploaded assets', async () => {
    const runtime = createHistoricalReviewRuntime('en',context);
    const target = { blockId: null };
    await expect(runtime.submitQuiz('quiz', {})).rejects.toThrow('read-only');
    await expect(runtime.checkQuestion('quiz', 'question', 'answer')).rejects.toThrow('read-only');
    await expect(runtime.submitAssignment(target, { text: 'answer' }, null)).rejects.toThrow('read-only');
    await expect(runtime.refreshAssignmentSession(target)).rejects.toThrow('read-only');
    const file = new File(['answer'], 'answer.txt', { type: 'text/plain' });
    await expect(runtime.uploadFile(file)).rejects.toThrow('read-only');
    await expect(runtime.uploadAssignmentFile(target, file)).rejects.toThrow('read-only');
  });

  it('does not retain mutable block state or invent an activity destination', () => {
    const runtime = createHistoricalReviewRuntime('en',context);
    runtime.setBlockState('question', { answer: 'new answer' });
    runtime.markViewed();
    runtime.onActivityComplete('question');
    expect(runtime.getBlockState('question')).toBeUndefined();
    expect(() => runtime.hrefFor({ kind: 'lesson', id: 'lesson' })).toThrow('do not provide activity navigation');
  });
});

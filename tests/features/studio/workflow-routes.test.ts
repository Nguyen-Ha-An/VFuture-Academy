import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflow: vi.fn(),
  withdrawReview: vi.fn(),
  approvalCandidate: vi.fn(),
  approveAndPublish: vi.fn(),
  prepareCoursePublication: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/admin/content-review-production', () => ({
  contentReviewContext: vi.fn(async () => ({ service: mocks })),
}));
vi.mock('@/features/studio/drafts', async (original) => {
  const actual = await original<typeof import('@/features/studio/drafts')>();
  return { ...actual, prepareCoursePublication: mocks.prepareCoursePublication };
});

import { POST as approveAndPublish } from '@/app/api/v1/studio/reviews/[reviewId]/approve-and-publish/route';

const reviewId = '00000000-0000-4000-8000-000000000010';
const checklist = {
  outcomesReviewed: true,
  answerKeysVerified: true,
  accessibilityReviewed: true,
  ageAppropriate: true,
  linksValid: true,
  warningsAcknowledged: true,
};

describe('Studio workflow routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps a course checklist valid on an idempotent published retry', async () => {
    mocks.approvalCandidate.mockResolvedValue({
      id: reviewId,
      contentType: 'course',
      contentId: 'course-one',
      revisionKey: 'revision-7',
      status: 'published',
    });
    mocks.approveAndPublish.mockResolvedValue({ id: reviewId, status: 'published' });

    const response = await approveAndPublish(new Request(`http://localhost/api/v1/studio/reviews/${reviewId}/approve-and-publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 'revision-7', note: 'Reviewed', checklist }),
    }), { params: Promise.resolve({ reviewId }) });

    expect(response.status).toBe(200);
    expect(mocks.prepareCoursePublication).not.toHaveBeenCalled();
    expect(mocks.approveAndPublish).toHaveBeenCalledWith(reviewId, 'revision-7', 'Reviewed', null);
  });
});

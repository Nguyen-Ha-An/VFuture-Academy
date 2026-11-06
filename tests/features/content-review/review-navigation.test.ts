import { describe, expect, it } from 'vitest';
import { reviewQueueReturnHref } from '@/features/content-review/review-navigation';

describe('review return destination', () => {
  it('retains the queue scope and filters', () => {
    expect(reviewQueueReturnHref('/studio/reviews?scope=central&q=Python&type=course')).toBe('/studio/reviews?scope=central&q=Python&type=course');
  });
  it.each(['https://example.com/studio/reviews', '//example.com/studio/reviews', '/\\example.com', '/studio/reviews/other', '/studio/reviews\n?scope=central', 'javascript:alert(1)', '/studio/reviews%2f..%2fadmin'])('rejects %s', value => {
    expect(reviewQueueReturnHref(value)).toBe('/studio/reviews');
  });
});

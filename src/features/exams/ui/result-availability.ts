import type { ExamReviewResult } from '../service';

/**
 * Whether the learner can actually see a score for this attempt, as opposed to whether the answer
 * key has been published (`review.released`) — the two are independent.
 *
 * Derived from the projected score, because that is what the page renders. The DTO's
 * `resultsAvailable` flag means something narrower: `resultAvailableAt !== null`, i.e. grading was
 * completed under the new model. A historical attempt released the legacy way has a visible score
 * with that flag `false`, so labelling from the flag alone would tell a learner their score is
 * "awaiting release" while it is on screen above the message. The flag is still honoured when set,
 * for the case of availability recorded without a score projection.
 */
export function resultsAvailable(review: ExamReviewResult): boolean {
  const flag = (review as ExamReviewResult & { resultsAvailable?: unknown }).resultsAvailable;
  return review.score !== undefined || flag === true;
}

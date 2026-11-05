'use client';

import { useMemo } from 'react';
import type { LearnerItem } from '@/content-engine/compile';
import type { Locale } from '@/content-engine/schema/common';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { ExamReviewResult } from '../service';
import type { HistoricalExamMediaContext } from '../historical-media';
import { ExamReview } from './ExamReview';
import { examSections } from './types';

/** Historical projections can render authorized media but cannot start or mutate an activity. */
export function createHistoricalReviewRuntime(locale: Locale, context: HistoricalExamMediaContext): LessonRuntime {
  const unavailable = async (): Promise<never> => { throw new Error('Historical exam reviews are read-only.'); };
  return {
    mode: 'learner', locale,
    getBlockState: () => undefined,
    setBlockState: () => {},
    getAssignmentSession: () => undefined,
    refreshAssignmentSession: unavailable,
    submitAssignment: unavailable,
    uploadAssignmentFile: unavailable,
    submitQuiz: unavailable,
    checkQuestion: unavailable,
    uploadFile: unavailable,
    resolveMedia: ref => {
      if (!('assetId' in ref)) return ref.url;
      const params = new URLSearchParams({ historicalExamAttemptId: context.attemptId, courseId: context.courseId, itemId: context.itemId });
      return `/api/v1/media/${encodeURIComponent(ref.assetId)}?${params}`;
    },
    hrefFor: () => { throw new Error('Historical exam reviews do not provide activity navigation.'); },
    markViewed: () => {},
    onActivityComplete: () => {},
  };
}

export function HistoricalExamReview({ learner, review, locale, context }: { learner: LearnerItem; review: ExamReviewResult; locale: Locale; context: HistoricalExamMediaContext }) {
  const {attemptId,courseId,itemId}=context;
  const runtime = useMemo(() => createHistoricalReviewRuntime(locale, {attemptId,courseId,itemId}), [locale,attemptId,courseId,itemId]);
  if (learner.kind !== 'exam') throw new TypeError('Historical exam review requires an exam projection.');
  const exam = { title: learner.title, sections: examSections(learner) };
  return <ExamReview exam={exam} review={review} runtime={runtime} hideTitle headingLevel={2} />;
}

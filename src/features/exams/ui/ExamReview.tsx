'use client';

import { useTranslations } from 'next-intl';
import { MentorQuote } from '@/features/workspace-ui/ui/primitives';
import { QuestionRenderer, registerAll, RichContentView } from '@/content-engine/render';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { ExamReviewResult } from '../service';
import type { LearnerExam } from './types';
import { resultsAvailable } from './result-availability';

registerAll();

export interface ExamReviewProps {
  exam: LearnerExam;
  review: ExamReviewResult;
  runtime: LessonRuntime;
  onStartNext?: () => void | Promise<void>;
  startingNext?: boolean;
  headingLevel?: 1 | 2;
  hideTitle?: boolean;
}

function feedbackQuestionNumbers(exam: LearnerExam): Map<string, number> {
  const numbers = new Map<string, number>();
  let number = 0;
  const visit = (question: Record<string, unknown>, questionNumber: number) => {
    if (typeof question.id === 'string') numbers.set(question.id, questionNumber);
    if (Array.isArray(question.questions)) {
      for (const child of question.questions) {
        if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
          visit(child as Record<string, unknown>, questionNumber);
        }
      }
    }
  };
  for (const section of exam.sections) {
    for (const question of section.questions) {
      number += 1;
      visit(question, number);
    }
  }
  return numbers;
}

export function ExamReview({ exam, review, runtime, onStartNext, startingNext = false, headingLevel = 1, hideTitle = false }: ExamReviewProps) {
  const t = useTranslations('exam.review');
  const results = new Map((review.results ?? []).map((result) => [result.questionId, result]));
  const questionNumbers = feedbackQuestionNumbers(exam);
  // Result availability and answer-key release are independent axes. Instructor feedback belongs
  // to the score, so it follows availability: a completed attempt shows its feedback immediately,
  // without waiting for the separate answer-key release. The server already applies the same
  // rule; this filter only drops feedback for questions outside the learner's own projection.
  const available = resultsAvailable(review);
  const manualFeedback = available || review.released
    ? Object.entries(review.manualFeedback ?? {}).filter(([questionId]) => questionNumbers.has(questionId))
    : [];
  let questionIndex = 0;
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const SectionTitle = headingLevel === 1 ? 'h2' : 'h3';

  return (
    <article className="min-w-0 overflow-hidden rounded-[8px] border border-border bg-card">
      <header className="border-b border-border px-5 py-6 min-[760px]:px-8">
        {!hideTitle ? <Title className="text-2xl font-semibold leading-snug">{t('title')}</Title> : null}
        <p className="mt-3 text-xl font-semibold tabular-nums">
          {review.score
            ? t('score', {
              points: review.score.points,
              maxPoints: review.score.maxPoints,
              percent: review.score.percent,
            })
            : t('scoreUnavailable')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{
          review.status === 'pending_manual'
            ? t('awaitingGrading')
            : review.status === 'expired'
              ? t('expired')
              : review.released
                ? t('released')
                // Grading finished and the score is the learner's, but the answer key is a
                // separate publication that has not happened yet.
                : available ? t('pendingRelease') : t('awaitingRelease')
        }</p>
        {review.late ? <p className="mt-1 text-sm text-destructive">{t('late')}</p> : null}
      </header>

      <div className="space-y-10 px-5 py-7 min-[760px]:px-8">
        {exam.sections.map((section) => (
          <section key={section.id} aria-labelledby={`exam-review-section-${section.id}`} className="space-y-5 border-b border-border pb-10 last:border-b-0 last:pb-0">
            <SectionTitle id={`exam-review-section-${section.id}`} className="text-xl font-semibold">{section.title}</SectionTitle>
            {section.instructions ? (
              <RichContentView
                content={section.instructions}
                runtime={runtime}
                path={`/exam/review/sections/${section.id}/instructions`}
                depth={1}
              />
            ) : null}
            {section.questions.map((question) => {
              const index = questionIndex;
              questionIndex += 1;
              return (
                <QuestionRenderer
                  key={question.id}
                  question={question}
                  index={index}
                  value={review.answers[question.id]}
                  onChange={() => {}}
                  disabled
                  result={results.get(question.id)}
                  revealed={review.revealed}
                  runtime={runtime}
                  depth={1}
                />
              );
            })}
          </section>
        ))}
      </div>
      {manualFeedback.length > 0 ? (
        <section aria-labelledby="exam-manual-feedback" className="border-t border-border px-5 py-7 min-[760px]:px-8">
          <SectionTitle id="exam-manual-feedback" className="text-xl font-semibold">{t('feedbackTitle')}</SectionTitle>
          <ul className="vf-exam-feedback mt-4 divide-y divide-border">
            {manualFeedback.map(([questionId, feedback]) => (
              <li key={questionId} className="py-2">
                <MentorQuote author={t('feedbackFor', { number: questionNumbers.get(questionId)! })}>{feedback}</MentorQuote>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {onStartNext ? (
        <div className="border-t border-border px-5 py-5 min-[760px]:px-8">
          <button type="button" className="vf-btn vf-btn-primary vf-btn-lg w-full min-[760px]:w-auto" disabled={startingNext} onClick={() => void onStartNext()}>
            {startingNext ? t('startingNext') : t('startNext')}
          </button>
        </div>
      ) : null}
    </article>
  );
}

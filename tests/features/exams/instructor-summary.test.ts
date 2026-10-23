import { describe, expect, it } from 'vitest';

import { pendingManualQuestionsForAttempt } from '@/features/exams/studio';
import type { ExamAnswerRecord, ExamAttemptRecord } from '@/features/exams/types';

describe('studio exam attempt summaries', () => {
  it('exposes only pending manual questions with learner-safe content and answers', () => {
    const now = new Date('2026-09-03T04:00:00.000Z');
    const attempt = {
      id: 'attempt-1',
      questionSet: {
        sections: [{ id: 'section', questionIds: ['section/essay', 'section/choice'], optionOrders: {}, deadlineOffsetMs: null }],
        learner: {
          kind: 'exam', id: 'exam-one', title: 'Exam One',
          sections: [{ questions: [
            { id: 'section/essay', type: 'essay', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain.' }] }] } },
            { id: 'section/choice', type: 'single_choice', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Choose.' }] }] } },
          ] }],
        },
        locale: 'en', defaultLocale: 'en',
      },
      gradingSnapshot: {
        questions: {
          'section/essay': { id: 'section/essay', type: 'essay', points: 5, settings: {}, interactionType: 'long_text', selfAssessment: false },
          'section/choice': { id: 'section/choice', type: 'single_choice', points: 1, settings: {}, interactionType: 'radio', selfAssessment: false, correctAnswer: 'a' },
        },
      },
    } as unknown as ExamAttemptRecord;
    const answers = [
      {
        attemptId: attempt.id, questionId: 'section/essay', answer: 'My explanation',
        result: { questionId: 'section/essay', status: 'pending_manual', points: 0, maxPoints: 5 },
        manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: now,
      },
      {
        attemptId: attempt.id, questionId: 'section/choice', answer: 'a',
        result: { questionId: 'section/choice', status: 'correct', points: 1, maxPoints: 1 },
        manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: now,
      },
    ] satisfies ExamAnswerRecord[];

    expect(pendingManualQuestionsForAttempt(attempt, answers)).toEqual([{
      questionId: 'section/essay', type: 'essay',
      content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain.' }] }] },
      answer: 'My explanation', maxPoints: 5, points: null, feedback: null,
    }]);
  });
});

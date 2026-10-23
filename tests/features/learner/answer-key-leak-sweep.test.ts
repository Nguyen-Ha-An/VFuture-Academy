import { describe, expect, it } from 'vitest';

import { assertNoAnswerKeys } from '@/content-engine/compile/project';
import type { QuizSubmitResult } from '@/content-engine/render/runtime';
import type { ExamReviewResult, ExamStartResult } from '@/features/exams/service';
import type { PublicCourseDetail } from '@/features/marketing/public-courses';
import type { PublicProfile } from '@/features/profile/service';
import type { getItemPayload } from '@/features/progress/service';

type ItemPayload = Awaited<ReturnType<typeof getItemPayload>>;

const learnerDtos = {
  itemPayload: {
    courseId: 'ai-foundations',
    courseVersionId: 'version-1',
    itemId: 'lesson-1',
    locale: 'en',
    item: {
      id: 'lesson-1',
      kind: 'lesson',
      blocks: [{ type: 'multiple_choice', id: 'q1', options: [{ id: 'a', label: 'A' }] }],
    },
    activityState: { q1: { state: { selected: 'a' }, completed: true, updatedAt: null } },
  } satisfies ItemPayload,
  quizResults: {
    attemptId: 'quiz-attempt-1',
    results: [{ questionId: 'q1', status: 'correct', points: 1, maxPoints: 1 }],
    points: 1,
    maxPoints: 1,
    percent: 100,
    passed: true,
    attemptsRemaining: 1,
    revealed: { correctAnswers: { q1: 'a' } },
  } satisfies QuizSubmitResult,
  examStart: {
    attemptId: 'exam-attempt-1',
    attemptNo: 1,
    status: 'in_progress',
    late: false,
    startedAt: new Date('2026-09-03T00:00:00.000Z'),
    deadlineAt: null,
    sectionDeadlines: { section1: null },
    answers: {},
    learner: { sections: [{ id: 'section1', questions: [{ id: 'q1', type: 'multiple_choice' }] }] },
  } satisfies ExamStartResult,
  examReview: {
    attemptId: 'exam-attempt-1',
    status: 'graded',
    late: false,
    released: true,
    answers: { q1: 'a' },
    results: [{ questionId: 'q1', status: 'correct', points: 1, maxPoints: 1 }],
    score: { points: 1, maxPoints: 1, percent: 100 },
    revealed: { correctAnswers: { q1: 'a' } },
  } satisfies ExamReviewResult,
  publicCourse: {
    id: 'ai-foundations',
    slug: 'ai-foundations',
    title: 'AI Foundations',
    summary: 'Learn AI fundamentals.',
    level: 'foundation',
    pathway: 'ai-emerging-technology',
    difficulty: 'beginner',
    estimatedMinutes: 120,
    skills: [{ id: 'ai-literacy', name: 'AI literacy' }],
    learningOutcomes: ['Explain AI systems.'],
    modules: [{
      id: 'module-1',
      title: 'Foundations',
      items: [{ id: 'lesson-1', type: 'lesson', title: 'What is AI?', required: true }],
    }],
    relatedOpportunityIds: [],
  } satisfies PublicCourseDetail,
  publicProfile: {
    handle: 'future_builder',
    displayName: 'Future Builder',
    avatarUrl: null,
    branch: { name: 'VinSMC' },
    completedCourses: [{ id: 'ai-foundations', title: 'AI Foundations', completedAt: '2026-09-03T00:00:00.000Z' }],
    skills: [{ id: 'ai-literacy', name: 'AI literacy', category: 'ai', level: 'applied', evidenceCount: 1 }],
    certificates: [{
      courseId: 'ai-foundations',
      title: 'AI Foundations',
      issuedAt: '2026-09-03T00:00:00.000Z',
      verificationCode: 'verify-1',
      href: '/verify/verify-1',
    }],
    projects: [{ id: 'project-1', title: 'Project', summary: 'Summary', outputLinks: [{ url: 'https://example.com' }] }],
  } satisfies PublicProfile,
} satisfies Record<string, unknown>;

describe('learner-facing DTO answer-key sweep', () => {
  it.each(Object.entries(learnerDtos))('%s contains no forbidden answer-key field', (_name, dto) => {
    expect(() => assertNoAnswerKeys(dto)).not.toThrow();
  });
});

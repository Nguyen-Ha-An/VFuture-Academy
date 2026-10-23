import { describe, it, expect } from 'vitest';
import { evaluateCompletion, evaluateLessonCompletion, type CompletionFacts } from '@/content-engine/grading/completion';
import type { GradingItem } from '@/content-engine/compile';

const facts: CompletionFacts = {
  items: [{ id: 'l1', type: 'lesson', required: true }, { id: 'l2', type: 'lesson', required: false }, { id: 'e1', type: 'exam', required: true }, { id: 'a1', type: 'assignment', required: true }],
  lessonsCompleted: ['l1'], examGrades: { e1: { percent: 80, passed: true } }, assignmentStatus: { a1: 'in_review' }, quizBest: { 'l1/quiz-1': 60 },
};

describe('evaluateCompletion', () => {
  it('all_items counts only required items and reports progress', () => {
    const r = evaluateCompletion([{ type: 'all_items' }], facts);
    expect(r.complete).toBe(false);
    expect(r.requirements[0]).toMatchObject({ satisfied: false, progress: { done: 2, total: 3 } });
    expect(evaluateCompletion([{ type: 'all_items' }], { ...facts, assignmentStatus: { a1: 'approved' } }).complete).toBe(true);
  });
  it('lessons_completed all vs list', () => {
    expect(evaluateCompletion([{ type: 'lessons_completed', lessonIds: 'all' }], facts).requirements[0]).toMatchObject({ satisfied: false, progress: { done: 1, total: 2 } });
    expect(evaluateCompletion([{ type: 'lessons_completed', lessonIds: ['l1'] }], facts).complete).toBe(true);
  });
  it('exam_passed, assignment_approved, quiz_min_score', () => {
    expect(evaluateCompletion([{ type: 'exam_passed', examId: 'e1' }], facts).complete).toBe(true);
    expect(evaluateCompletion([{ type: 'exam_passed', examId: 'missing' }], facts).complete).toBe(false);
    expect(evaluateCompletion([{ type: 'assignment_approved', assignmentId: 'a1' }], facts).complete).toBe(false);
    expect(evaluateCompletion([{ type: 'quiz_min_score', lessonId: 'l1', quizId: 'quiz-1', percent: 50 }], facts).complete).toBe(true);
    expect(evaluateCompletion([{ type: 'quiz_min_score', lessonId: 'l1', quizId: 'quiz-1', percent: 70 }], facts).complete).toBe(false);
  });
  it('all rules must hold', () => {
    expect(evaluateCompletion([{ type: 'exam_passed', examId: 'e1' }, { type: 'assignment_approved', assignmentId: 'a1' }], facts).complete).toBe(false);
  });
});

describe('evaluateLessonCompletion', () => {
  const grading = (mode: 'view' | 'activities'): GradingItem => ({ questions: {}, quizzes: { 'quiz-1': { mode: 'graded', attemptsAllowed: 3, feedback: 'after_submit', showExplanations: true, shuffleQuestions: false, required: true, passPercent: 70, questionIds: [] } }, rubrics: {}, activities: [{ id: 'quiz-1', type: 'quiz', required: true }, { id: 'ref-1', type: 'reflection', required: true }, { id: 'rev', type: 'reveal', required: false }], lessonCompletionMode: mode });
  it('view mode completes on view', () => {
    expect(evaluateLessonCompletion(grading('view'), { viewed: true, completedActivities: [], quizBest: {} })).toEqual({ complete: true, pending: [] });
  });
  it('activities mode needs every required activity, quizzes must reach passPercent', () => {
    expect(evaluateLessonCompletion(grading('activities'), { viewed: true, completedActivities: ['quiz-1'], quizBest: { 'quiz-1': 60 } })).toEqual({ complete: false, pending: ['quiz-1', 'ref-1'] });
    expect(evaluateLessonCompletion(grading('activities'), { viewed: true, completedActivities: ['quiz-1', 'ref-1'], quizBest: { 'quiz-1': 75 } })).toEqual({ complete: true, pending: [] });
  });
});

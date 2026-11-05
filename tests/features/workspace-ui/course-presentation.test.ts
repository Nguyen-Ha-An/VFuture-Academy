import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { courseDuration, requirementTargets } from '@/features/workspace-ui/learner/course-presentation';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';

const items = [
  { id: 'midterm', type: 'exam', title: 'Midterm assessment' },
  { id: 'final', type: 'exam', title: 'Final assessment' },
  { id: 'project', type: 'assignment', title: 'Community project' },
  { id: 'lesson', type: 'lesson', title: 'Working with evidence' },
];

describe('course requirement presentation', () => {
  it('distinguishes exam rules using the exact supplied outline names', () => {
    expect(requirementTargets({ type: 'exam_passed', examId: 'midterm' }, items)).toEqual([{ id: 'midterm', title: 'Midterm assessment', itemId: 'midterm' }]);
    expect(requirementTargets({ type: 'exam_passed', examId: 'final' }, items)).toEqual([{ id: 'final', title: 'Final assessment', itemId: 'final' }]);
    expect(requirementTargets({ type: 'assignment_approved', assignmentId: 'project' }, items)).toEqual([{ id: 'project', title: 'Community project', itemId: 'project' }]);
  });

  it('keeps unresolved, mismatched and ambiguous IDs explicit without inventing links', () => {
    expect(requirementTargets({ type: 'assignment_approved', assignmentId: 'embedded-work' }, items)).toEqual([{ id: 'embedded-work', title: null }]);
    expect(requirementTargets({ type: 'exam_passed', examId: 'project' }, items)).toEqual([{ id: 'project', title: null }]);
    expect(requirementTargets({ type: 'exam_passed', examId: 'midterm' }, [...items, items[0]])).toEqual([{ id: 'midterm', title: null }]);
  });

  it('uses the quiz rule’s explicit lesson identity without claiming an observed quiz title', () => {
    expect(requirementTargets({ type: 'quiz_min_score', lessonId: 'lesson', quizId: 'quiz-a', percent: 80 }, items)).toEqual([
      { id: 'lesson', title: 'Working with evidence' }, { id: 'quiz-a', title: null },
    ]);
  });

  it('preserves explicit lesson order and leaves aggregate rules without invented targets', () => {
    expect(requirementTargets({ type: 'lessons_completed', lessonIds: ['lesson', 'missing'] }, items)).toEqual([
      { id: 'lesson', title: 'Working with evidence', itemId: 'lesson' }, { id: 'missing', title: null },
    ]);
    expect(requirementTargets({ type: 'all_items' }, items)).toEqual([]);
    expect(requirementTargets({ type: 'lessons_completed', lessonIds: 'all' }, items)).toEqual([]);
  });
});

describe('course duration presentation', () => {
  it('converts whole hours and retains remaining minutes', () => {
    expect(courseDuration(1560)).toEqual({ hours: 26, minutes: 0 });
    expect(courseDuration(1590)).toEqual({ hours: 26, minutes: 30 });
    expect(courseDuration(45)).toEqual({ hours: 0, minutes: 45 });
  });
  it('does not invent a value for missing or invalid published minutes', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) expect(courseDuration(value)).toBeNull();
  });
  it('uses localized hour and minute labels without losing the remainder', () => {
    const english = createTranslator({ locale: 'en', messages: en, namespace: 'learner.course' });
    const vietnamese = createTranslator({ locale: 'vi', messages: vi, namespace: 'learner.course' });
    expect(english('durationHours', courseDuration(1560)!)).toBe('26h');
    expect(vietnamese('durationHours', courseDuration(1560)!)).toBe('26 giờ');
    expect(english('durationHoursMinutes', courseDuration(1590)!)).toBe('26h 30 min');
    expect(vietnamese('durationHoursMinutes', courseDuration(1590)!)).toBe('26 giờ 30 phút');
  });
});

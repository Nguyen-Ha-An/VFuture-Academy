// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/notebooks/ui/NotebookSubmissionPreview', () => ({ NotebookSubmissionPreview: () => null }));

import { assignmentOptionLabels } from '@/features/instructor-grading/SubmissionsWorkspace';
import type { AssignmentMetadata } from '@/features/instructor-grading/types';

const VERSION = '11111111-1111-4111-8111-111111111111';

function assignment(overrides: Partial<AssignmentMetadata>): AssignmentMetadata {
  return {
    courseId: 'course-a', courseTitle: 'Design thinking', courseVersionId: VERSION,
    itemId: 'lesson-1', itemTitle: 'Week 1 reflection', assignmentId: 'lesson-1', rubric: { criteria: [] },
    ...overrides,
  };
}

describe('assignment filter labels', () => {
  it('shows the item title without the raw assignment id', () => {
    const labels = assignmentOptionLabels([assignment({ assignmentId: 'assignment-block-7' })]);
    expect(labels.get('assignment-block-7')).toBe('Week 1 reflection');
  });

  it('uses the server-resolved outline title when metadata only has the item id', () => {
    const labels = assignmentOptionLabels(
      [assignment({ itemTitle: 'lesson-1' })],
      { [VERSION]: { courseTitle: 'Design thinking', items: { 'lesson-1': 'Bài tập tuần 1' } } },
    );
    expect(labels.get('lesson-1')).toBe('Bài tập tuần 1');
  });

  it('uses readable fallbacks when metadata contains record ids rather than titles', () => {
    const labels = assignmentOptionLabels(
      [
        assignment({ itemTitle: 'assignment-block-7', assignmentId: 'assignment-block-7' }),
        assignment({ itemTitle: 'lesson-1', assignmentId: 'another-id', courseTitle: 'course-a' }),
      ],
      undefined,
      { item: 'Untitled item', course: 'Untitled course' },
    );
    expect(labels.get('assignment-block-7')).toBe('Untitled item · Design thinking');
    expect(labels.get('another-id')).toBe('Untitled item · Untitled course');
  });

  it('tells apart same-titled items by course, then by number within one item', () => {
    const labels = assignmentOptionLabels([
      assignment({ assignmentId: 'a', itemTitle: 'Final project', courseTitle: 'Design thinking' }),
      assignment({ assignmentId: 'b', itemTitle: 'Final project', courseTitle: 'Robotics', courseId: 'course-b' }),
      assignment({ assignmentId: 'c', itemTitle: 'Lab', itemId: 'lab' }),
      assignment({ assignmentId: 'd', itemTitle: 'Lab', itemId: 'lab' }),
    ]);
    expect(labels.get('a')).toBe('Final project · Design thinking');
    expect(labels.get('b')).toBe('Final project · Robotics');
    expect(labels.get('c')).toBe('Lab · Design thinking (1)');
    expect(labels.get('d')).toBe('Lab · Design thinking (2)');
  });
});

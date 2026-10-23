import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadCompletionRows } from '@/features/learning/shared';
import { successful, SupabaseStub } from './test-kit';

describe('learner completion rows', () => {
  it('preserves an earned released approval even if legacy data contains a newer revision', async () => {
    const client = new SupabaseStub({
      lesson_progress: [successful([])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([
        { item_id: 'assignment-1', block_id: null, status: 'changes_requested', submitted_at: '2026-09-03T00:00:00Z', grades: [{ decision: 'changes_requested', released: true }] },
        { item_id: 'assignment-1', block_id: null, status: 'approved', submitted_at: '2026-09-02T00:00:00Z', grades: [{ decision: 'approved', released: true }] },
      ])],
      quiz_attempts: [successful([])],
    });

    const { facts } = await loadCompletionRows(client, 'learner-1', 'version-1', [{
      id: 'assignment-1', type: 'assignment', required: true,
    }]);

    expect(facts.assignmentStatus).toEqual({ 'assignment-1': 'approved' });
    expect(client.queriesFor('assignment_submissions')[0].operations).toContainEqual([
      'order', 'submitted_at', { ascending: false },
    ]);
  });

  it('keys inline completion by block and ignores an unreleased approval', async () => {
    const client = new SupabaseStub({
      lesson_progress: [successful([])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([
        { item_id: 'lesson-1', block_id: 'inline-final', status: 'approved', submitted_at: '2026-09-03T00:00:00Z', grades: [{ decision: 'approved', released: false }] },
        { item_id: 'assignment-1', block_id: null, status: 'approved', submitted_at: '2026-09-03T00:00:00Z', grades: [{ decision: 'approved', released: true }] },
      ])],
      quiz_attempts: [successful([])],
    });

    const { facts } = await loadCompletionRows(client, 'learner-1', 'version-1', []);

    expect(facts.assignmentStatus).toEqual({
      'inline-final': 'in_review',
      'assignment-1': 'approved',
    });
    expect(client.queriesFor('assignment_submissions')[0].operations[0]).toEqual([
      'select', 'item_id,block_id,status,submitted_at,grades(decision,released)',
    ]);
  });
});

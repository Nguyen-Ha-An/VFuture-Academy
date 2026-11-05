import { describe, expect, it } from 'vitest';
import { assignmentLocators, deadlineInput, AnnouncementRevisionSchema, AnnouncementUpdateSchema } from '@/features/teaching/contracts';

describe('teaching schedules', () => {
  it('only exposes assignment identities present in published grading snapshots', () => {
    expect(assignmentLocators([{ item_id: 'lesson', kind: 'lesson', grading: { assignments: { 'block-a': {}, 'block-b': {} } } }, { item_id: 'homework', kind: 'assignment', grading: { assignments: { homework: {} } } }])).toEqual([{itemId:'lesson',blockId:'block-a'}, {itemId:'lesson',blockId:'block-b'}, {itemId:'homework',blockId:null}]);
  });
  it('requires bounded integer revisions and at least one edit field', () => {
    for (const value of [undefined, 0, -1, 1.5, '1', 2147483648]) expect(AnnouncementRevisionSchema.safeParse({ expectedRevision: value }).success).toBe(false);
    expect(AnnouncementRevisionSchema.safeParse({ expectedRevision: 1 }).success).toBe(true);
    expect(AnnouncementUpdateSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(AnnouncementUpdateSchema.safeParse({ expectedRevision: 1, body: 'New text' }).success).toBe(true);
  });
  it('accepts explicit UTC deadlines and rejects local or offset-less dates', () => {
    expect(deadlineInput.safeParse('2026-12-01T10:00:00Z').success).toBe(true);
    expect(deadlineInput.safeParse('2026-12-01T17:00:00').success).toBe(false);
    expect(deadlineInput.safeParse(null).success).toBe(true);
  });
});

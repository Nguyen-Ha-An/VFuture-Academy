import { z } from 'zod';
import { IdSchema } from '@/content-engine/schema/common';

export const deadlineInput = z.string().datetime().nullable();
export const ScheduleSchema = z.object({
  branchId: z.string().min(1).max(100), courseVersionId: z.string().uuid(),
  itemId: IdSchema, blockId: IdSchema.nullable(), dueAt: deadlineInput,
}).strict();
export const AnnouncementCreateSchema = z.object({
  branchId: z.string().min(1).max(100), courseId: IdSchema,
  title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000),
}).strict();
export const AnnouncementRevisionSchema = z.object({ expectedRevision: z.number().int().min(1).max(2147483647) }).strict();
export const AnnouncementUpdateSchema = AnnouncementRevisionSchema.extend({
  title: AnnouncementCreateSchema.shape.title.optional(),
  body: AnnouncementCreateSchema.shape.body.optional(),
}).strict().refine(value => value.title !== undefined || value.body !== undefined);
export type AssignmentLocator = { itemId: string; blockId: string | null };
export function assignmentLocators(items: readonly {item_id: string; kind: string; grading: unknown}[]): AssignmentLocator[] {
  return items.flatMap(item => {
    const grading = item.grading && typeof item.grading === 'object' && !Array.isArray(item.grading) ? item.grading as Record<string, unknown> : {};
    const assignments = grading.assignments && typeof grading.assignments === 'object' && !Array.isArray(grading.assignments) ? grading.assignments as Record<string, unknown> : {};
    return Object.keys(assignments).flatMap<AssignmentLocator>(id => item.kind === 'assignment'
      ? id === item.item_id ? [{ itemId: item.item_id, blockId: null }] : []
      : [{ itemId: item.item_id, blockId: id }]);
  });
}

import { z } from 'zod';
import { IdSchema } from '@/content-engine/schema/common';

export const TeachingBranchId = z.string().min(1).max(100);
export const TeachingCourseId = IdSchema;
export const TeacherRole = z.enum(['primary', 'assistant']);
export const ReplaceCourseTeachersSchema = z.object({
  branchId: TeachingBranchId,
  expectedRevision: z.number().int().min(0).max(2147483646),
  teachers: z.array(z.object({ userId: z.string().uuid(), role: TeacherRole }).strict()).max(100),
}).strict().superRefine((input, context) => {
  if (new Set(input.teachers.map(teacher => teacher.userId)).size !== input.teachers.length) {
    context.addIssue({ code: 'custom', path: ['teachers'], message: 'Each teacher must appear once' });
  }
  if (input.teachers.length > 0 && input.teachers.filter(teacher => teacher.role === 'primary').length !== 1) {
    context.addIssue({ code: 'custom', path: ['teachers'], message: 'Choose exactly one primary teacher' });
  }
});
export const TeachingCourseScopeSchema = z.object({
  all: z.boolean(), branchIds: z.array(z.string()),
  assignments: z.array(z.object({ courseId: z.string(), branchId: z.string() })),
});
export const CourseTeachersSchema = z.object({
  courseId: z.string(), branchId: z.string().nullable(), branchScopeKnown: z.boolean().optional(), revision: z.number().int().min(0),
  teachers: z.array(z.object({ userId: z.string().uuid().optional(), displayName: z.string(), role: TeacherRole })),
});
export const TeacherOptionsSchema = z.object({
  teachers: z.array(z.object({ userId: z.string().uuid(), displayName: z.string(), handle: z.string().nullable() })),
  hasMore: z.boolean(), page: z.number().int(), pageSize: z.number().int(),
});
export const AssignedCoursesSchema = z.object({ courses: z.array(z.object({
  courseId: z.string(), title: z.string(), branchId: z.string(), branchName: z.string(), role: TeacherRole,
})) });
export type CourseTeachers = z.infer<typeof CourseTeachersSchema>;
export type ReplaceCourseTeachers = z.infer<typeof ReplaceCourseTeachersSchema>;
export type TeachingCourseScope = z.infer<typeof TeachingCourseScopeSchema>;

import { z } from 'zod';
import { DOCUMENT_KINDS, type DocumentKind } from './common';
import { CourseDocumentSchema } from './course';
import { LessonDocumentSchema } from './lesson';
import { ExamDocumentSchema } from './exam';
import { AssignmentDocumentSchema, QuestionBundleSchema, ResourceDocumentSchema } from './bundle';

export const SCHEMAS_BY_KIND = {
  course: CourseDocumentSchema, lesson: LessonDocumentSchema, exam: ExamDocumentSchema,
  assignment: AssignmentDocumentSchema, question_bundle: QuestionBundleSchema, resource: ResourceDocumentSchema,
} as const;
export type AnyDocument = z.infer<(typeof SCHEMAS_BY_KIND)[DocumentKind]>;

export const DocumentSchema = z.union([CourseDocumentSchema, LessonDocumentSchema, ExamDocumentSchema, AssignmentDocumentSchema, QuestionBundleSchema, ResourceDocumentSchema]);

export function detectKind(raw: unknown): DocumentKind | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const k = (raw as { kind?: unknown }).kind;
  return typeof k === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(k) ? (k as DocumentKind) : null;
}
export const schemaForKind = (kind: DocumentKind) => SCHEMAS_BY_KIND[kind];

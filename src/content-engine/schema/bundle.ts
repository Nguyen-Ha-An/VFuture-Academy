import { z } from 'zod';
import { envelopeFields, IdSchema, L10nStringSchema, MediaRefSchema } from './common';
import { L10nRichContentSchema } from './rich-content';
import { QuestionSchema } from './questions';
import { assignmentBodyFields } from './activities';
import { standaloneLanguageFields } from './lesson';
import { CourseAccessSchema, PATHWAYS } from './course';

const { id: _id, ...assignmentRest } = assignmentBodyFields;
export const AssignmentDocumentSchema = z.object({ ...envelopeFields('assignment'), ...standaloneLanguageFields, ...assignmentRest }).strict();
export type AssignmentDocument = z.infer<typeof AssignmentDocumentSchema>;

export const QuestionBundleSchema = z.object({ ...envelopeFields('question_bundle'), ...standaloneLanguageFields, title: L10nStringSchema.optional(), questions: z.array(QuestionSchema).min(1).max(500) }).strict();
export type QuestionBundle = z.infer<typeof QuestionBundleSchema>;

export const RESOURCE_TYPES = ['guide', 'cheat_sheet', 'template', 'recording', 'reading', 'tool', 'competition_breakdown', 'opportunity_guide', 'student_note', 'mentor_note', 'project_walkthrough'] as const;
export const ResourceDocumentSchema = z.object({
  ...envelopeFields('resource'), ...standaloneLanguageFields,
  title: L10nStringSchema, summary: L10nStringSchema, resourceType: z.enum(RESOURCE_TYPES),
  tags: z.array(z.string().max(40)).max(20).optional(), skills: z.array(IdSchema).max(20).optional(), pathways: z.array(z.enum(PATHWAYS)).max(5).optional(),
  branchScope: CourseAccessSchema.optional(),
  body: L10nRichContentSchema,   // content blocks only (RichContent), so activity blocks fail structurally
  attachments: z.array(z.object({ src: MediaRefSchema, label: L10nStringSchema }).strict()).max(20).optional(),
}).strict();
export type ResourceDocument = z.infer<typeof ResourceDocumentSchema>;

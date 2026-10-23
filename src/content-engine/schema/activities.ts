import { z } from 'zod';
import { HttpsUrlSchema, IdSchema, L10nStringSchema } from './common';
import { L10nRichContentSchema } from './rich-content';
import { CODE_LANGUAGES, RubricSchema, QuizQuestionEntrySchema } from './questions';
import { isSupportedUploadMime, MAX_SUBMISSION_UPLOAD_MB } from './uploads';
import { NotebookAssignmentSchema } from './notebook';

export const ACTIVITY_BLOCK_TYPES = ['quiz', 'assignment', 'reflection', 'flashcards', 'accordion', 'tabs', 'reveal', 'stepper', 'resource_link', 'opportunity_link', 'next_step'] as const;
export const CONTAINER_BLOCK_TYPES = ['callout', 'accordion', 'tabs', 'reveal', 'stepper'] as const;
export type ActivityBlockType = (typeof ACTIVITY_BLOCK_TYPES)[number];

export const QuizSettingsSchema = z.object({
  mode: z.enum(['practice', 'graded']).optional(),
  attemptsAllowed: z.number().int().min(0).max(100).optional(),
  feedback: z.enum(['per_question', 'after_submit', 'none']).optional(),
  showExplanations: z.boolean().optional(),
  shuffleQuestions: z.boolean().optional(),
  passPercent: z.number().min(0).max(100).optional(),
  required: z.boolean().optional(),
}).strict();

export const QuizBlockSchema = z.object({
  id: IdSchema, type: z.literal('quiz'),
  title: L10nStringSchema.optional(), intro: L10nRichContentSchema.optional(),
  questions: z.array(QuizQuestionEntrySchema).min(1).max(50),
  settings: QuizSettingsSchema.optional(),
}).strict();

export const SubmissionSpecSchema = z.object({
  accepts: z.array(z.enum(['text', 'link', 'file', 'code'])).min(1).max(4),
  maxFiles: z.number().int().min(1).max(10).optional(),
  maxFileSizeMB: z.number().int().min(1).max(MAX_SUBMISSION_UPLOAD_MB).optional(),
  allowedMimeTypes: z.array(
    z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/).refine(isSupportedUploadMime, 'MIME type is not supported by uploads'),
  ).max(30).optional(),
  linkHosts: z.array(z.string().min(3).max(100)).max(30).optional(),
  codeLanguage: z.enum(CODE_LANGUAGES).optional(),
}).strict();

export const assignmentBodyFields = {
  id: IdSchema,
  title: L10nStringSchema,
  instructions: L10nRichContentSchema,
  submission: SubmissionSpecSchema,
  rubric: RubricSchema.optional(),
  passPoints: z.number().min(0).optional(),
  skills: z.array(IdSchema).max(10).optional(),
  resubmission: z.enum(['until_approved', 'once', 'never']).optional(),
  required: z.boolean().optional(),
  notebook: NotebookAssignmentSchema.optional(),
};
export const AssignmentBlockSchema = z.object({ type: z.literal('assignment'), ...assignmentBodyFields }).strict();

export const ReflectionBlockSchema = z.object({ id: IdSchema, type: z.literal('reflection'), prompt: L10nRichContentSchema, required: z.boolean().optional(), minChars: z.number().int().min(0).optional(), maxChars: z.number().int().min(1).max(20000).optional() }).strict();
export const FlashcardsBlockSchema = z.object({ id: IdSchema, type: z.literal('flashcards'), cards: z.array(z.object({ id: IdSchema, front: L10nRichContentSchema, back: L10nRichContentSchema }).strict()).min(1).max(100), shuffle: z.boolean().optional() }).strict();
export const ResourceLinkBlockSchema = z.object({ id: IdSchema, type: z.literal('resource_link'), resourceId: IdSchema, label: L10nStringSchema.optional(), required: z.boolean().optional() }).strict();
export const OpportunityLinkBlockSchema = z.object({ id: IdSchema, type: z.literal('opportunity_link'), opportunityId: IdSchema, relationship: z.enum(['recommended_next_step', 'related', 'prerequisite_for']) }).strict();
export const NextStepBlockSchema = z.object({
  id: IdSchema, type: z.literal('next_step'), title: L10nStringSchema, description: L10nStringSchema.optional(),
  target: z.union([
    z.object({ kind: z.enum(['lesson', 'exam', 'course', 'opportunity']), id: IdSchema }).strict(),
    z.object({ kind: z.literal('url'), url: HttpsUrlSchema }).strict(),
  ]),
}).strict();

/** Containers holding arbitrary lesson blocks; `children` is the recursive block schema. */
export function containerSchemas<C extends z.ZodTypeAny>(children: C) {
  const titled = z.object({ id: IdSchema, title: L10nStringSchema, blocks: z.array(children).min(1).max(100) }).strict();
  return {
    accordion: z.object({ id: IdSchema, type: z.literal('accordion'), items: z.array(titled).min(1).max(30), allowMultipleOpen: z.boolean().optional() }).strict(),
    tabs: z.object({ id: IdSchema, type: z.literal('tabs'), items: z.array(titled).min(1).max(12) }).strict(),
    reveal: z.object({ id: IdSchema, type: z.literal('reveal'), label: L10nStringSchema, blocks: z.array(children).min(1).max(100) }).strict(),
    stepper: z.object({ id: IdSchema, type: z.literal('stepper'), steps: z.array(titled).min(1).max(30), linear: z.boolean().optional() }).strict(),
  };
}

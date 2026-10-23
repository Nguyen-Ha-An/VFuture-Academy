import { z } from 'zod';
import { L10nStringSchema } from '../common';
import { L10nRichContentSchema } from '../rich-content';
import { CODE_LANGUAGES, RubricSchema, questionBaseFields } from './base';
import { isSupportedUploadMime, MAX_SUBMISSION_UPLOAD_MB } from '../uploads';

// Manually graded questions have no answer key. `correctAnswer` used to be accepted as
// `unknown` and then merely warned about, which let an authored answer key survive into
// storage where nothing would ever grade it. These schemas are strict, so the field is
// now rejected outright instead of silently carried.

export const EssaySchema = z.object({
  ...questionBaseFields,
  type: z.literal('essay'),
  prompts: z.array(L10nStringSchema).min(1).max(10).optional(),
  minWords: z.number().int().min(0).max(5000).optional(),
  maxWords: z.number().int().min(1).max(10000).optional(),
  rubric: RubricSchema.optional(),
  sampleAnswer: L10nRichContentSchema.optional(),
}).strict();

export const UploadAnswerSchema = z.object({
  ...questionBaseFields,
  type: z.literal('upload_answer'),
  accepts: z.array(z.enum(['file', 'link', 'text'])).min(1).max(3),
  allowedMimeTypes: z.array(
    z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/).refine(isSupportedUploadMime, 'MIME type is not supported by uploads'),
  ).max(20).optional(),
  maxFiles: z.number().int().min(1).max(10).optional(),
  maxFileSizeMB: z.number().int().min(1).max(MAX_SUBMISSION_UPLOAD_MB).optional(),
  linkHosts: z.array(z.string().min(3).max(100)).max(20).optional(),
  rubric: RubricSchema.optional(),
}).strict();

export const CodeAnswerSchema = z.object({
  ...questionBaseFields,
  type: z.literal('code_answer'),
  language: z.enum(CODE_LANGUAGES),
  starterCode: z.string().max(20000).optional(),
  minLines: z.number().int().min(1).max(1000).optional(),
  rubric: RubricSchema.optional(),
  sampleSolution: z.string().max(20000).optional(),
}).strict();

export type EssayQuestion = z.infer<typeof EssaySchema>;
export type UploadAnswerQuestion = z.infer<typeof UploadAnswerSchema>;
export type CodeAnswerQuestion = z.infer<typeof CodeAnswerSchema>;

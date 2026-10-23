import { z } from 'zod';
import { IdSchema, L10nStringSchema } from '../common';
import { L10nRichContentSchema } from '../rich-content';

export const CODE_LANGUAGES = ['python', 'javascript', 'typescript', 'html', 'css', 'sql', 'json', 'markdown', 'plaintext'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export const QuestionSettingsSchema = z.object({
  shuffleOptions: z.boolean().optional(),
  partialScoring: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  ignoreAccents: z.boolean().optional(),
  decimalComma: z.boolean().optional(),
}).strict();
export type QuestionSettings = z.infer<typeof QuestionSettingsSchema>;

export const DisplaySchema = z.object({
  interactionType: z.string().regex(/^[a-z_]{2,32}$/).optional(),
  layout: z.enum(['list', 'grid_2', 'inline', 'tabs']).optional(),
}).strict();

export const RubricSchema = z.object({
  criteria: z.array(z.object({
    id: IdSchema,
    name: L10nStringSchema,
    description: L10nStringSchema.optional(),
    maxPoints: z.number().min(0).max(100),
    levels: z.array(z.object({ points: z.number().min(0).max(100), label: L10nStringSchema, description: L10nStringSchema.optional() }).strict()).min(2).max(6).optional(),
  }).strict()).min(1).max(12),
}).strict();
export type Rubric = z.infer<typeof RubricSchema>;
export const rubricMaxPoints = (r: Rubric) => r.criteria.reduce((s, c) => s + c.maxPoints, 0);

/** Fields shared by every question type. `content` is the stem. */
export const questionBaseFields = {
  id: IdSchema,
  points: z.number().min(0).max(1000).optional(),
  content: L10nRichContentSchema,
  explanation: L10nRichContentSchema.optional(),
  hint: L10nRichContentSchema.optional(),
  settings: QuestionSettingsSchema.optional(),
  display: DisplaySchema.optional(),
  selfAssessment: z.boolean().optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  skills: z.array(IdSchema).max(10).optional(),
  accessibility: z.object({ transcript: L10nStringSchema.optional() }).strict().optional(),
};

export const OptionSchema = z.object({ id: IdSchema, content: L10nRichContentSchema, feedback: L10nRichContentSchema.optional() }).strict();
export type Option = z.infer<typeof OptionSchema>;
export const PairItemSchema = z.object({ id: IdSchema, content: L10nRichContentSchema }).strict();

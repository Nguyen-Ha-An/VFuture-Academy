import { z } from 'zod';
import { envelopeFields, IdSchema, L10nStringSchema, LOCALES, LocaleSchema } from './common';
import { buildContentBlockSchemas, CONTENT_BLOCK_TYPES } from './rich-content';
import { ACTIVITY_BLOCK_TYPES, AssignmentBlockSchema, FlashcardsBlockSchema, NextStepBlockSchema, OpportunityLinkBlockSchema, QuizBlockSchema, ReflectionBlockSchema, ResourceLinkBlockSchema, containerSchemas } from './activities';
import type { LessonBlock } from './types';

export const LESSON_BLOCK_TYPES = [...CONTENT_BLOCK_TYPES, ...ACTIVITY_BLOCK_TYPES] as const;
export type LessonBlockType = (typeof LESSON_BLOCK_TYPES)[number];

export const LessonBlockSchema: z.ZodType<LessonBlock> = z.lazy(() => {
  const c = buildContentBlockSchemas(LessonBlockSchema);
  const k = containerSchemas(LessonBlockSchema);
  return z.union([
    c.paragraph, c.heading, c.list, c.quote, c.image, c.video, c.audio, c.table, c.code, c.divider, c.embed, c.pdf, c.callout, c.math, c.diagram,
    QuizBlockSchema, AssignmentBlockSchema, ReflectionBlockSchema, FlashcardsBlockSchema,
    k.accordion, k.tabs, k.reveal, k.stepper,
    ResourceLinkBlockSchema, OpportunityLinkBlockSchema, NextStepBlockSchema,
  ]) as unknown as z.ZodType<LessonBlock>;
});

export const lessonBodyFields = {
  title: L10nStringSchema,
  summary: L10nStringSchema.optional(),
  objectives: z.array(L10nStringSchema).max(12).optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  completion: z.object({ mode: z.enum(['view', 'activities']) }).strict().optional(),
  blocks: z.array(LessonBlockSchema).min(1).max(400),
};

export const standaloneLanguageFields = {
  languages: z.array(LocaleSchema).min(1).max(LOCALES.length).optional(),
  defaultLanguage: LocaleSchema.optional(),
};

export const LessonDocumentSchema = z.object({ ...envelopeFields('lesson'), ...standaloneLanguageFields, ...lessonBodyFields }).strict();
export type LessonDocument = z.infer<typeof LessonDocumentSchema>;
export { IdSchema };

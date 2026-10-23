import { z } from 'zod';
import { envelopeFields, IdSchema, L10nStringSchema } from './common';
import { L10nRichContentSchema } from './rich-content';
import { ExamQuestionEntrySchema } from './questions';
import { standaloneLanguageFields } from './lesson';

const Reveal = z.enum(['immediately', 'on_release', 'never']);

export const ExamSettingsSchema = z.object({
  timeLimitMinutes: z.number().int().min(1).max(600).optional(),
  attemptsAllowed: z.number().int().min(1).max(20).optional(),
  scoringPolicy: z.enum(['best', 'latest', 'first', 'average']).optional(),
  availability: z.object({ openAt: z.iso.datetime().optional(), closeAt: z.iso.datetime().optional(), lateSubmission: z.enum(['reject', 'accept_flagged']).optional() }).strict()
    .refine((a) => !a.openAt || !a.closeAt || Date.parse(a.openAt) < Date.parse(a.closeAt), { message: 'openAt must be before closeAt' }).optional(),
  passPercent: z.number().min(0).max(100).optional(),
  review: z.object({ showScore: Reveal.optional(), showCorrectAnswers: Reveal.optional(), showExplanations: Reveal.optional(), releaseAt: z.iso.datetime().nullable().optional() }).strict().optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  navigation: z.enum(['free', 'sequential']).optional(),
  layout: z.enum(['one_per_page', 'section_per_page', 'single_page']).optional(),
  integrity: z.object({ logFocusLoss: z.boolean().optional(), logPaste: z.boolean().optional(), requireFullscreen: z.boolean().optional() }).strict().optional(),
  required: z.boolean().optional(),
}).strict();
export type ExamSettings = z.infer<typeof ExamSettingsSchema>;

export const ExamSectionSchema = z.object({
  id: IdSchema, title: L10nStringSchema, instructions: L10nRichContentSchema.optional(),
  timeLimitMinutes: z.number().int().min(1).max(600).optional(),
  questions: z.array(ExamQuestionEntrySchema).min(1).max(200),
}).strict();

export const examBodyFields = {
  title: L10nStringSchema,
  description: L10nRichContentSchema.optional(),
  settings: ExamSettingsSchema.optional(),
  sections: z.array(ExamSectionSchema).min(1).max(20),
};

type ExamTimerConfiguration = {
  sections: Array<{ timeLimitMinutes?: number }>;
};

export function validateExamTimerConfiguration(exam: ExamTimerConfiguration, context: z.RefinementCtx) {
  const timedSections = exam.sections.filter(({ timeLimitMinutes }) => timeLimitMinutes !== undefined).length;
  if (timedSections > 0 && timedSections < exam.sections.length) {
    context.addIssue({
      code: 'custom',
      path: ['sections'],
      message: 'Either every section must be timed or every section must be untimed',
    });
  }
}

export const ExamDocumentSchema = z.object({ ...envelopeFields('exam'), ...standaloneLanguageFields, ...examBodyFields })
  .strict()
  .superRefine(validateExamTimerConfiguration);
export type ExamDocument = z.infer<typeof ExamDocumentSchema>;

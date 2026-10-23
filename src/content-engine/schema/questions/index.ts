import { z } from 'zod';
import { IdSchema } from '../common';
import { L10nRichContentSchema } from '../rich-content';
import { DIFFICULTIES, questionBaseFields } from './base';
import { SingleChoiceSchema, MultipleChoiceSchema, TrueFalseSchema } from './choice';
import { FillBlankSchema, ShortAnswerSchema, NumericSchema } from './text';
import { MatchingSchema, OrderingSchema, ClassificationSchema } from './structure';
import { EssaySchema, UploadAnswerSchema, CodeAnswerSchema } from './manual';

export * from './base';
export * from './choice';
export * from './text';
export * from './structure';
export * from './manual';

export const AUTO_GRADED_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'numeric', 'matching', 'ordering', 'classification'] as const;
export const MANUAL_TYPES = ['essay', 'upload_answer', 'code_answer'] as const;
export const QUESTION_TYPES = [...AUTO_GRADED_TYPES, ...MANUAL_TYPES, 'question_group'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type AutoGradedType = (typeof AUTO_GRADED_TYPES)[number];
export type ManualType = (typeof MANUAL_TYPES)[number];

export const LeafQuestionSchema = z.discriminatedUnion('type', [
  SingleChoiceSchema, MultipleChoiceSchema, TrueFalseSchema,
  FillBlankSchema, ShortAnswerSchema, NumericSchema,
  MatchingSchema, OrderingSchema, ClassificationSchema,
  EssaySchema, UploadAnswerSchema, CodeAnswerSchema,
]);
export type LeafQuestion = z.infer<typeof LeafQuestionSchema>;

export const QuestionGroupSchema = z.object({
  ...questionBaseFields,
  content: L10nRichContentSchema.optional(),
  type: z.literal('question_group'),
  sharedContent: L10nRichContentSchema,
  questions: z.array(LeafQuestionSchema).min(1).max(20),
}).strict();
export type QuestionGroup = z.infer<typeof QuestionGroupSchema>;

export const QuestionSchema = z.discriminatedUnion('type', [...LeafQuestionSchema.options, QuestionGroupSchema]);
export type Question = z.infer<typeof QuestionSchema>;

const BANK_REF = /^bank:([a-z0-9][a-z0-9-]{0,63})$/;
export const QuestionRefSchema = z.object({ $ref: z.string().regex(BANK_REF, 'expected "bank:<question-id>"') }).strict();
export type QuestionRef = z.infer<typeof QuestionRefSchema>;

export const PoolDrawSchema = z.object({
  $pool: z.object({
    id: IdSchema,
    count: z.number().int().min(1).max(100),
    pointsEach: z.number().min(0).max(100).optional(),
    from: z.array(z.string().regex(BANK_REF)).min(1).max(500).optional(),
    filter: z.object({ tags: z.array(z.string()).min(1).max(20).optional(), difficulty: z.array(z.enum(DIFFICULTIES)).min(1).optional(), types: z.array(z.enum(QUESTION_TYPES)).min(1).optional() }).strict().optional(),
  }).strict().refine((p) => (p.from ? 1 : 0) + (p.filter ? 1 : 0) === 1, { message: 'exactly one of from / filter' }),
}).strict();
export type PoolDraw = z.infer<typeof PoolDrawSchema>;

export const QuizQuestionEntrySchema = z.union([QuestionRefSchema, QuestionSchema]);
export const ExamQuestionEntrySchema = z.union([QuestionRefSchema, PoolDrawSchema, QuestionSchema]);
export type QuizQuestionEntry = z.infer<typeof QuizQuestionEntrySchema>;
export type ExamQuestionEntry = z.infer<typeof ExamQuestionEntrySchema>;

export const isQuestionRef = (e: unknown): e is QuestionRef => typeof e === 'object' && e !== null && '$ref' in e && typeof (e as { $ref?: unknown }).$ref === 'string' && BANK_REF.test((e as { $ref: string }).$ref);
export const isPoolDraw = (e: unknown): e is PoolDraw => typeof e === 'object' && e !== null && '$pool' in e;
export const bankIdOf = (ref: QuestionRef): string => {
  const match = ref.$ref.match(BANK_REF);
  if (!match) throw new Error(`invalid bank ref: ${ref.$ref}`);
  return match[1];
};
export const isManualType = (t: string): t is ManualType => (MANUAL_TYPES as readonly string[]).includes(t);
export const isAutoGradedType = (t: string): t is AutoGradedType => (AUTO_GRADED_TYPES as readonly string[]).includes(t);

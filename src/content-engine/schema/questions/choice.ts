import { z } from 'zod';
import { L10nStringSchema } from '../common';
import { OptionSchema, questionBaseFields } from './base';

export const SingleChoiceSchema = z.object({
  ...questionBaseFields,
  type: z.literal('single_choice'),
  options: z.array(OptionSchema).min(2).max(10),
  correctAnswer: z.string().optional(),
}).strict();

export const MultipleChoiceSchema = z.object({
  ...questionBaseFields,
  type: z.literal('multiple_choice'),
  options: z.array(OptionSchema).min(2).max(12),
  minSelections: z.number().int().min(1).max(12).optional(),
  maxSelections: z.number().int().min(1).max(12).optional(),
  correctAnswer: z.array(z.string()).min(1).max(12).optional(),
}).strict();

export const TrueFalseSchema = z.object({
  ...questionBaseFields,
  type: z.literal('true_false'),
  labels: z.object({ true: L10nStringSchema, false: L10nStringSchema }).strict().optional(),
  correctAnswer: z.boolean().optional(),
}).strict();

export type SingleChoiceQuestion = z.infer<typeof SingleChoiceSchema>;
export type MultipleChoiceQuestion = z.infer<typeof MultipleChoiceSchema>;
export type TrueFalseQuestion = z.infer<typeof TrueFalseSchema>;

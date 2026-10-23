import { z } from 'zod';
import { IdSchema, L10nStringSchema } from '../common';
import { questionBaseFields } from './base';

const AcceptedSchema = z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).min(1).max(20)]);

export const FillBlankSchema = z.object({
  ...questionBaseFields,
  type: z.literal('fill_blank'),
  blanks: z.array(z.object({ id: IdSchema, options: z.array(L10nStringSchema).min(2).max(10).optional(), width: z.enum(['sm', 'md', 'lg']).optional() }).strict()).min(1).max(30),
  wordBank: z.array(z.object({ id: IdSchema, text: L10nStringSchema }).strict()).min(2).max(40).optional(),
  correctAnswer: z.record(z.string(), AcceptedSchema).optional(),
}).strict();

export const ShortAnswerSchema = z.object({
  ...questionBaseFields,
  type: z.literal('short_answer'),
  matchMode: z.enum(['exact', 'contains', 'regex']).optional(),
  maxLength: z.number().int().min(1).max(1000).optional(),
  correctAnswer: z.array(z.string().min(1).max(500)).min(1).max(50).optional(),
}).strict();

export const NumericSchema = z.object({
  ...questionBaseFields,
  type: z.literal('numeric'),
  tolerance: z.number().min(0).optional(),
  tolerancePercent: z.number().min(0).max(100).optional(),
  unit: L10nStringSchema.optional(),
  precision: z.number().int().min(0).max(10).optional(),
  correctAnswer: z.number().finite().optional(),
}).strict();

export type FillBlankQuestion = z.infer<typeof FillBlankSchema>;
export type ShortAnswerQuestion = z.infer<typeof ShortAnswerSchema>;
export type NumericQuestion = z.infer<typeof NumericSchema>;

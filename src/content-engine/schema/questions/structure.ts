import { z } from 'zod';
import { IdSchema, L10nStringSchema } from '../common';
import { PairItemSchema, questionBaseFields } from './base';

export const MatchingSchema = z.object({
  ...questionBaseFields,
  type: z.literal('matching'),
  left: z.array(PairItemSchema).min(2).max(15),
  right: z.array(PairItemSchema).min(2).max(20),
  allowManyToOne: z.boolean().optional(),
  correctAnswer: z.array(z.object({ left: z.string(), right: z.string() }).strict()).min(1).max(30).optional(),
}).strict();

export const OrderingSchema = z.object({
  ...questionBaseFields,
  type: z.literal('ordering'),
  items: z.array(PairItemSchema).min(2).max(15),
  slots: z.array(z.object({ id: IdSchema, label: L10nStringSchema }).strict()).min(2).max(15).optional(),
  correctAnswer: z.array(z.string()).min(2).max(15).optional(),
}).strict();

export const ClassificationSchema = z.object({
  ...questionBaseFields,
  type: z.literal('classification'),
  categories: z.array(z.object({ id: IdSchema, label: L10nStringSchema }).strict()).min(2).max(8),
  items: z.array(PairItemSchema).min(2).max(30),
  correctAnswer: z.record(z.string(), z.string()).optional(),
}).strict();

export type MatchingQuestion = z.infer<typeof MatchingSchema>;
export type OrderingQuestion = z.infer<typeof OrderingSchema>;
export type ClassificationQuestion = z.infer<typeof ClassificationSchema>;

import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { ApiError } from '@/lib/api';
import { ExamError } from './types';

export const AttemptIdSchema = z.uuid();
export const CourseVersionIdSchema = z.uuid();
// Branch IDs use the same bounded slug contract as administration (e.g. vinsmc).
export const BranchIdSchema = IdSchema;
export const ExamItemIdSchema = IdSchema;
export const QuestionIdSchema = z.string()
  .min(1)
  .max(194)
  .regex(/^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,2}$/);

const answerPrimitiveSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const answerArraySchema = z.array(answerPrimitiveSchema).max(200);
const answerLeafRecordSchema = z.record(
  z.string().min(1).max(194),
  z.union([answerPrimitiveSchema, answerArraySchema]),
).refine((answer) => Object.keys(answer).length <= 200, 'Too many answer fields');
const answerRecordSchema = z.record(
  z.string().min(1).max(194),
  z.union([answerPrimitiveSchema, answerArraySchema, answerLeafRecordSchema]),
).refine((answer) => Object.keys(answer).length <= 200, 'Too many answer fields');

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? Number.POSITIVE_INFINITY
    : new TextEncoder().encode(serialized).byteLength;
}

export const ExamAnswersSchema = z.record(
  QuestionIdSchema,
  z.union([answerPrimitiveSchema, answerArraySchema, answerRecordSchema]),
).refine((answers) => Object.keys(answers).length <= 250, {
  message: 'At most 250 answers may be saved at once',
}).refine((answers) => serializedBytes(answers) <= 64 * 1024, {
  message: 'Exam answers exceed 64 KiB',
});

export const ExamEventMetaSchema = z.record(z.string(), z.unknown())
  .refine((meta) => serializedBytes(meta) <= 2 * 1024, {
    message: 'Exam event metadata exceeds 2 KiB',
  });

export async function examOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ExamError) {
      throw new ApiError(error.httpStatus, error.code, error.message, undefined,
        error.httpStatus === 503 ? { 'Retry-After': '60' } : undefined);
    }
    if (error instanceof RangeError) {
      throw new ApiError(400, 'INVALID_GRADE', error.message);
    }
    throw error;
  }
}

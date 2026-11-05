import { z } from 'zod';

import { IdSchema } from '@/content-engine/schema/common';
import { ApiError } from '@/lib/api';
import { answerMapSchema } from '@/features/learning/answer-input';
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

export const ExamAnswersSchema = answerMapSchema(QuestionIdSchema, 250);

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).byteLength;
}

export const ExamEventMetaSchema = z.record(z.string(), z.unknown())
  .refine((meta) => serializedBytes(meta) <= 2 * 1024, {
    message: 'Exam event metadata exceeds 2 KiB',
  });

/** Finite response stream with the same JSON envelope as `ok`, serialized before headers. */
export function streamExamJson(data:unknown):Response {
  const json=JSON.stringify({data});
  if(json===undefined) throw new TypeError('Exam response is not JSON serializable');
  // Encode once, then split bytes: UTF-16 slicing can bisect an emoji pair.
  const bytes=new TextEncoder().encode(json);let offset=0;
  const stream=new ReadableStream<Uint8Array>({
    pull(controller) {
      if(offset>=bytes.length){controller.close();return;}
      const end=Math.min(offset+16*1024,bytes.length);
      controller.enqueue(bytes.subarray(offset,end));
      offset=end;
    },
  });
  return new Response(stream,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','vary':'Cookie'}});
}

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

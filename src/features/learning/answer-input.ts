import { z } from 'zod';

/** Bounded JSON values emitted by question renderers, including matching edges and uploads. */
export type AnswerValue = null | boolean | number | string | AnswerValue[] | { [key: string]: AnswerValue };
const MAX_CHILDREN = 200;
const MAX_DEPTH = 4;
const MAX_BYTES = 64 * 1024;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function validAnswer(value: unknown, depth: number): value is AnswerValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_BYTES;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= MAX_DEPTH) return false;
  if (Array.isArray(value)) return value.length <= MAX_CHILDREN && value.every(entry => validAnswer(entry, depth + 1));
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_CHILDREN && entries.every(([key, entry]) =>
    key.length > 0 && key.length <= 194 && !unsafeKeys.has(key) && validAnswer(entry, depth + 1));
}
export function answerBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).byteLength;
}
/** Explicit structural, size, depth and key bounds; service-level question validation still applies. */
export const AnswerValueSchema = z.custom<AnswerValue>((value) => validAnswer(value, 0) && answerBytes(value) <= MAX_BYTES, 'Invalid answer value');
export function answerMapSchema(questionId: z.ZodType<string>, maximum: number) {
  return z.record(questionId, AnswerValueSchema)
    .refine(answers => Object.keys(answers).length <= maximum, 'Too many answers')
    .refine(answers => answerBytes(answers) <= MAX_BYTES, 'Answers exceed 64 KiB');
}

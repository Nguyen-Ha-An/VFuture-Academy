import { z } from 'zod';
import type { GradingQuestion } from '@/content-engine/compile';
import { AnswerValueSchema } from '@/features/learning/answer-input';

const identifier = z.string().min(1).max(194);
const text = z.string().max(64 * 1024);
const textArray = z.array(text).max(200);
const ids = z.array(identifier).max(200);
const entries = z.record(identifier, text).refine(value => Object.keys(value).length <= 200);
const edge = z.object({ left: identifier, right: identifier }).strict();
const file = z.object({
  assetId: z.string().min(1).max(80), name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().safe(), mime: z.string().min(1).max(200),
}).strict();
const link = z.object({
  url: z.string().max(2048).url().refine(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
  }),
  label: z.string().max(200).optional(),
}).strict();
const upload = z.object({ text: text.optional(), files: z.array(file).max(10).optional(), links: z.array(link).max(20).optional() }).strict();
const code = z.object({ language: z.string().min(1).max(40), code: text }).strict();

/** Fail closed when a persistence path has no configured attachment validator. */
export function containsAttachmentReferences(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAttachmentReferences);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, entry]) => {
    if (key === 'files' && entry !== null && entry !== undefined) {
      if (!Array.isArray(entry) || entry.length > 0) return true;
    }
    return containsAttachmentReferences(entry);
  });
}

/** Checks transport shape against the immutable grading snapshot, not a client-supplied type. */
export function validQuestionAnswer(question: GradingQuestion, value: unknown): boolean {
  if (!AnswerValueSchema.safeParse(value).success) return false;
  if (value === null) return true;
  switch (question.type) {
    case 'single_choice': return identifier.safeParse(value).success;
    case 'multiple_choice': return ids.safeParse(value).success;
    case 'true_false': return typeof value === 'boolean';
    case 'fill_blank':
    case 'classification': return entries.safeParse(value).success;
    case 'short_answer': return text.safeParse(value).success;
    case 'numeric': return text.safeParse(value).success || typeof value === 'number' && Number.isFinite(value);
    case 'matching': return z.array(edge).max(200).safeParse(value).success;
    case 'ordering': return ids.safeParse(value).success;
    case 'essay': return text.safeParse(value).success || textArray.safeParse(value).success;
    case 'upload_answer': return upload.safeParse(value).success;
    case 'code_answer': return code.safeParse(value).success;
    case 'question_group': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const children = question.children ?? [];
      return Object.entries(value).every(([key, childValue]) => {
        const child = children.find(candidate => candidate.id.startsWith(`${question.id}/`) && (candidate.id === key || candidate.id.slice(question.id.length + 1) === key));
        return child !== undefined && validQuestionAnswer(child, childValue);
      });
    }
    default: return false;
  }
}

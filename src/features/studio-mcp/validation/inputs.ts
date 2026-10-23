import { z } from 'zod';

import { MAX_DOCUMENT_BYTES, utf8ByteLength } from '@/content-engine/validate/parse';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
// 32 tokens × (slash + 512 RFC 6901 characters encoded as two bytes).
const pointer = z.string().max(32_800);

const edit = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: pointer, value: z.json() }),
  z.strictObject({ op: z.literal('replace'), path: pointer, value: z.json() }),
  z.strictObject({ op: z.literal('remove'), path: pointer }),
]);

const document = z.record(z.string(), z.json()).refine(
  value => utf8ByteLength(JSON.stringify(value, null, 2)) <= MAX_DOCUMENT_BYTES,
  { message: 'Document exceeds the content size limit.' },
);

const proposalShape = {
  courseId: id,
  itemId: id,
  // Optional at the SDK boundary so the tool can return BASE_HASH_REQUIRED.
  // The handler requires it before any draft read or proposal evaluation.
  baseItemHash: hash.optional(),
  edits: z.array(edit).min(1).max(200).optional(),
  document: document.optional(),
};

const exactlyOneProposal = (input: { edits?: unknown; document?: unknown }) =>
  (input.edits === undefined) !== (input.document === undefined);

export const validateItemInputSchema = z.strictObject(proposalShape).refine(exactlyOneProposal, {
  message: 'Supply either edits or document.',
});

export const prepareImportInputSchema = z.strictObject({
  ...proposalShape,
  baseDraftUpdatedAt: z.string().max(64).optional(),
  uiLocale: z.enum(['en', 'vi']).default('en'),
}).refine(exactlyOneProposal, { message: 'Supply either edits or document.' });

export const verifyImportInputSchema = z.strictObject({
  courseId: id,
  itemId: id,
  baseItemHash: hash,
  proposedItemHash: hash,
  importText: z.string().min(1).refine(value => utf8ByteLength(value) <= 80 * 1024),
  preparationProof: z.string().min(1).max(128),
});

export type ValidateItemInput = z.output<typeof validateItemInputSchema>;
export type PrepareImportInput = z.output<typeof prepareImportInputSchema>;
export type VerifyImportToolInput = z.output<typeof verifyImportInputSchema>;

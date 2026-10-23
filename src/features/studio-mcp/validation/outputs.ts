import { z } from 'zod';

const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const envelope = {
  rules: z.array(z.string()),
  nextStep: z.string(),
  profileVersion: z.string(),
};
const changeSummary = z.strictObject({
  addedIds: z.array(z.string()),
  removedIds: z.array(z.string()),
  changedIds: z.array(z.string()),
});
const issue = z.strictObject({
  layer: z.enum(['profile', 'patch', 'parse', 'document', 'import', 'workspace', 'save']),
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  pointer: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  rule: z.string().optional(),
  meta: z.strictObject({
    count: z.number().int().nonnegative(),
    paths: z.array(z.string().max(512)).max(20),
  }).optional(),
});

export const validateItemOutputSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(issue).max(100),
  warnings: z.array(issue).max(100),
  truncated: z.boolean(),
  base: z.strictObject({ draftUpdatedAt: z.string().nullable(), revision: z.string(), itemHash: hash }),
  proposedItemHash: hash,
  proposedBytes: z.number().int().nonnegative(),
  reviewPending: z.boolean(),
  changeSummary,
  ...envelope,
});

/** Large importText moves into the text channel; metadata still validates. */
export const prepareImportOutputSchema = z.strictObject({
  ready: z.literal(true),
  itemId: z.string(),
  kind: z.enum(['lesson', 'exam', 'assignment']),
  moduleId: z.string(),
  moduleTitle: z.string(),
  importText: z.string().optional(),
  payloadInText: z.literal(true).optional(),
  importTextSha256: z.string().regex(/^[0-9a-f]{64}$/),
  preparationProof: z.string().regex(/^v1\.[0-9]{13}\.[0-9a-f]{64}$/),
  baseItemHash: hash,
  proposedItemHash: hash,
  bytes: z.number().int().nonnegative(),
  studioUrl: z.string().url(),
  ownerScopeKey: z.string(),
  steps: z.array(z.string()),
  warnings: z.array(z.strictObject({
    code: z.enum(['DRAFT_MOVED_ON', 'AUTOSAVE_AFTER_APPLY', 'LARGE_PAYLOAD']),
    message: z.string(),
  })),
  changeSummary,
  ...envelope,
});

export const verifyImportOutputSchema = z.strictObject({
  status: z.enum(['VERIFIED', 'MISMATCH', 'NOT_SAVED_YET']),
  storedItemHash: hash,
  draftUpdatedAt: z.string().nullable(),
  diff: changeSummary.optional(),
  ...envelope,
});

import { describe, expect, it } from 'vitest';

import {
  prepareImportInputSchema, validateItemInputSchema, verifyImportInputSchema,
} from '@/features/studio-mcp/validation/inputs';

const hash = `sha256:${'a'.repeat(64)}`;
const base = { courseId: 'course-a', itemId: 'lesson-1', baseItemHash: hash };

describe('import tool inputs', () => {
  it('requires exactly one proposal representation and rejects unknown keys', () => {
    expect(validateItemInputSchema.safeParse({ ...base, edits: [{ op: 'remove', path: '/title' }] }).success).toBe(true);
    expect(validateItemInputSchema.safeParse({ ...base, document: { id: 'lesson-1' } }).success).toBe(true);
    expect(validateItemInputSchema.safeParse(base).success).toBe(false);
    expect(validateItemInputSchema.safeParse({ ...base, document: {}, edits: [{ op: 'remove', path: '/title' }] }).success).toBe(false);
    expect(validateItemInputSchema.safeParse({ ...base, document: {}, extra: true }).success).toBe(false);
  });

  it('lets the tool return BASE_HASH_REQUIRED for an omitted base hash', () => {
    expect(validateItemInputSchema.safeParse({ courseId: 'course-a', itemId: 'lesson-1', document: { id: 'lesson-1' } }).success).toBe(true);
    expect(prepareImportInputSchema.safeParse({ courseId: 'course-a', itemId: 'lesson-1', document: { id: 'lesson-1' } }).success).toBe(true);
  });

  it('rejects non-JSON values and malformed patch operations', () => {
    expect(validateItemInputSchema.safeParse({ ...base, document: { fn: () => 1 } }).success).toBe(false);
    expect(validateItemInputSchema.safeParse({ ...base, edits: [{ op: 'add', path: '/title' }] }).success).toBe(false);
    expect(validateItemInputSchema.safeParse({ ...base, edits: [{ op: 'remove', path: '/title', value: 1 }] }).success).toBe(false);
  });

  it('accepts the maximum RFC 6901 encoding of 32 decoded 512-character tokens', () => {
    const pointer = Array.from({ length: 32 }, () => `/${'~0'.repeat(512)}`).join('');
    expect(pointer).toHaveLength(32_800);
    expect(validateItemInputSchema.safeParse({ ...base, edits: [{ op: 'remove', path: pointer }] }).success).toBe(true);
    expect(validateItemInputSchema.safeParse({ ...base, edits: [{ op: 'remove', path: `${pointer}x` }] }).success).toBe(false);
  });

  it('bounds preparation and verification metadata', () => {
    expect(prepareImportInputSchema.safeParse({ ...base, document: {}, uiLocale: 'vi', baseDraftUpdatedAt: 'x' }).success).toBe(true);
    expect(prepareImportInputSchema.safeParse({ ...base, document: {}, uiLocale: 'fr' }).success).toBe(false);
    const verify = { courseId: 'course-a', itemId: 'lesson-1', baseItemHash: hash, proposedItemHash: hash, importText: '{}' };
    expect(verifyImportInputSchema.safeParse(verify).success).toBe(false);
    expect(verifyImportInputSchema.safeParse({ ...verify, preparationProof: `v1.0000000000000.${'a'.repeat(64)}` }).success).toBe(true);
    expect(verifyImportInputSchema.safeParse({ ...verify, preparationProof: 'proof', override: true }).success).toBe(false);
  });
});

import { checksumOf, stableStringify } from '@/content-engine/compile/checksum';
import { itemRef } from '@/content-engine/diagnostics';
import { ID_PATTERN } from '@/content-engine/schema/common';
import { parseJsonDocument } from '@/content-engine/validate/parse';
import type { CourseDraft } from '@/features/studio/drafts';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_IMPORT_TEXT_BYTES = 80 * 1024;

export class VerifyImportError extends Error {
  constructor(readonly code: 'ITEM_NOT_FOUND' | 'INVALID_INPUT' | 'IMPORT_TEXT_MISMATCH', message: string) {
    super(message);
    this.name = 'VerifyImportError';
  }
}

export type VerifyImportInput = {
  baseItemHash: string;
  proposedItemHash: string;
  importText: string;
};

export type VerifyImportResult = {
  status: 'VERIFIED' | 'MISMATCH' | 'NOT_SAVED_YET';
  storedItemHash: string;
  draftUpdatedAt: string | null;
  diff?: { addedIds: string[]; removedIds: string[]; changedIds: string[] };
  nextStep: string;
};

type IdDiff = NonNullable<VerifyImportResult['diff']>;

/** Keep only an id in a parent's fingerprint so a child edit identifies the child. */
function itemNodesById(document: unknown): Map<string, string> {
  const nodes = new Map<string, string>();

  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;

    const source = value as Record<string, unknown>;
    const direct: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(source)) direct[key] = visit(child);

    const id = source.id;
    if (typeof id === 'string' && ID_PATTERN.test(id)) {
      nodes.set(id, stableStringify(direct));
      return { id };
    }
    return direct;
  }

  visit(document);
  return nodes;
}

function diffItemIds(proposed: unknown, stored: unknown): IdDiff {
  const expected = itemNodesById(proposed);
  const actual = itemNodesById(stored);
  return {
    addedIds: [...actual.keys()].filter((id) => !expected.has(id)).sort(),
    removedIds: [...expected.keys()].filter((id) => !actual.has(id)).sort(),
    changedIds: [...actual.keys()].filter((id) => expected.has(id) && actual.get(id) !== expected.get(id)).sort(),
  };
}

export async function verifyStoredImport(
  draft: CourseDraft,
  itemId: string,
  input: VerifyImportInput,
): Promise<VerifyImportResult> {
  if (!Object.hasOwn(draft.items, itemId)) {
    throw new VerifyImportError('ITEM_NOT_FOUND', 'The item is no longer in the draft.');
  }
  if (!HASH_PATTERN.test(input.baseItemHash) || !HASH_PATTERN.test(input.proposedItemHash)) {
    throw new VerifyImportError('INVALID_INPUT', 'Item hashes must use the sha256 format.');
  }

  const parsed = parseJsonDocument(input.importText, itemRef(itemId), { maxBytes: MAX_IMPORT_TEXT_BYTES });
  if (parsed.errors.length || (parsed.value as Record<string, unknown> | undefined)?.id !== itemId
    || input.importText !== JSON.stringify(parsed.value, null, 2)) {
    throw new VerifyImportError('IMPORT_TEXT_MISMATCH', 'The supplied import text is not the prepared item.');
  }

  const expectedHash = `sha256:${await checksumOf(parsed.value)}`;
  if (expectedHash !== input.proposedItemHash) {
    throw new VerifyImportError('IMPORT_TEXT_MISMATCH', 'The supplied import text does not match the proposed item hash.');
  }

  const storedItem = draft.items[itemId];
  const storedItemHash = `sha256:${await checksumOf(storedItem)}`;
  const common = { storedItemHash, draftUpdatedAt: draft.updatedAt };
  if (storedItemHash === input.proposedItemHash) {
    return { ...common, status: 'VERIFIED', nextStep: 'Import verified. Continue reviewing the draft in Studio.' };
  }
  if (storedItemHash === input.baseItemHash) {
    return { ...common, status: 'NOT_SAVED_YET', nextStep: 'Save the item in Studio, wait for autosave, then run verify_import again.' };
  }
  return {
    ...common,
    status: 'MISMATCH',
    diff: diffItemIds(parsed.value, storedItem),
    nextStep: 'Inspect the saved item in Studio and prepare a new import from the current draft.',
  };
}

import { describe, expect, it } from 'vitest';

import { sha256Hex, stableStringify } from '@/content-engine/compile/checksum';
import { verifyStoredImport } from '@/features/studio-mcp/validation/verify-import';
import type { CourseDraft } from '@/features/studio/drafts';

const updatedAt = '2026-09-26T08:00:00Z';

const baseItem = {
  schemaVersion: 1,
  kind: 'lesson',
  id: 'lesson-a',
  title: 'Original title',
  blocks: [{ id: 'quiz-a', type: 'quiz', questions: [{ id: 'q1', prompt: 'Original prompt' }] }],
};

function draftWith(item: unknown): CourseDraft {
  return {
    id: 'draft-a', courseId: 'course-a', manifest: {},
    items: { 'lesson-a': item }, baseVersionId: null, checklist: null,
    updatedAt,
  };
}

async function hash(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(stableStringify(value))}`;
}

async function inputFor(proposed: unknown) {
  return {
    baseItemHash: await hash(baseItem),
    proposedItemHash: await hash(proposed),
    importText: JSON.stringify(proposed, null, 2),
  };
}

describe('verifyStoredImport', () => {
  it('verifies a stored item with the proposed canonical hash', async () => {
    const proposed = { ...baseItem, title: 'Revised title' };
    const stored = { title: 'Revised title', blocks: baseItem.blocks, id: baseItem.id, kind: baseItem.kind, schemaVersion: baseItem.schemaVersion };
    const result = await verifyStoredImport(draftWith(stored), 'lesson-a', await inputFor(proposed));

    expect(result).toEqual({
      status: 'VERIFIED',
      storedItemHash: await hash(proposed),
      draftUpdatedAt: updatedAt,
      nextStep: expect.any(String),
    });
    expect(result.nextStep).not.toContain('Revised title');
  });

  it('reports an unchanged base as not saved yet', async () => {
    const proposed = { ...baseItem, title: 'Revised title' };
    const result = await verifyStoredImport(draftWith(baseItem), 'lesson-a', await inputFor(proposed));

    expect(result.status).toBe('NOT_SAVED_YET');
    expect(result.storedItemHash).toBe(await hash(baseItem));
    expect(result.draftUpdatedAt).toBe(updatedAt);
    expect(result).not.toHaveProperty('diff');
  });

  it('reports only ids and hash when a different version was saved', async () => {
    const proposed = {
      ...baseItem,
      blocks: [{ id: 'quiz-a', type: 'quiz', questions: [
        { id: 'q1', prompt: 'Expected secret content' },
        { id: 'q3', prompt: 'Expected only' },
      ] }],
    };
    const stored = {
      ...baseItem,
      blocks: [{ id: 'quiz-a', type: 'quiz', questions: [
        { id: 'q1', prompt: 'Stored secret content' },
        { id: 'q2', prompt: 'Stored only' },
      ] }],
    };
    const result = await verifyStoredImport(draftWith(stored), 'lesson-a', await inputFor(proposed));

    expect(result.status).toBe('MISMATCH');
    expect(result.storedItemHash).toBe(await hash(stored));
    expect(result.diff).toEqual({
      addedIds: ['q2'],
      removedIds: ['q3'],
      changedIds: ['q1', 'quiz-a'],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret content|Stored only|Expected only/);
  });

  it('rejects import text that no longer hashes to the proposed item', async () => {
    const proposed = { ...baseItem, title: 'Revised title' };
    const input = await inputFor(proposed);
    input.importText = input.importText.replace('Revised title', 'Altered title');

    await expect(verifyStoredImport(draftWith(baseItem), 'lesson-a', input))
      .rejects.toMatchObject({ code: 'IMPORT_TEXT_MISMATCH' });
  });

  it('rejects a missing target item', async () => {
    const proposed = { ...baseItem, title: 'Revised title' };
    const draft = draftWith(baseItem);
    draft.items = {};

    await expect(verifyStoredImport(draft, 'lesson-a', await inputFor(proposed)))
      .rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });

  it('keeps JSON object keys named __proto__ in the mismatch summary', async () => {
    const proposed = JSON.parse('{"id":"lesson-a","kind":"lesson","schemaVersion":1,"__proto__":{"flag":"expected"}}');
    const stored = JSON.parse('{"id":"lesson-a","kind":"lesson","schemaVersion":1,"__proto__":{"flag":"stored"}}');

    const result = await verifyStoredImport(draftWith(stored), 'lesson-a', await inputFor(proposed));

    expect(result.status).toBe('MISMATCH');
    expect(result.diff?.changedIds).toEqual(['lesson-a']);
  });
});

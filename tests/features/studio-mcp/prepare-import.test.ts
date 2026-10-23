import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import enMessages from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { dialogMessages, replaceMessage } from '@/features/studio/ui/dialog-messages';
import { ImportPackageError, prepareImportPackage } from '@/features/studio-mcp/import-package';

const LIMIT = 80 * 1024;

function simulation(document: Record<string, unknown> = { id: 'lesson-a', kind: 'lesson', title: 'Café' }) {
  const importText = JSON.stringify(document, null, 2);
  return {
    valid: true,
    errors: [] as Array<{ code: string; pointer: string; message: string }>,
    warnings: [],
    truncated: false,
    base: { draftUpdatedAt: '2026-09-26T01:00:00.000Z', revision: 'rev-1', itemHash: `sha256:${'a'.repeat(64)}` },
    proposedItemHash: `sha256:${'b'.repeat(64)}`,
    proposedBytes: Buffer.byteLength(importText, 'utf8'),
    reviewPending: false,
    changeSummary: { addedIds: ['new-question'], removedIds: ['old-question'], changedIds: ['lesson-a'] },
    document,
    importText,
    workspaceBytes: 1_000,
    itemId: 'lesson-a',
    kind: 'lesson' as const,
    moduleId: 'module-a',
    moduleTitle: 'Module A',
  };
}

function input(overrides: Partial<ReturnType<typeof simulation>> = {}) {
  return {
    simulation: { ...simulation(), ...overrides },
    courseId: 'course-a',
    origin: 'https://academy.example.test',
    ownerScopeKey: 'branch:school-a',
  };
}

describe('prepareImportPackage', () => {
  it('returns exact import JSON, digest, hashes, summary, and a path-only Studio URL', () => {
    const source = input();
    const result = prepareImportPackage(source);
    const importText = JSON.stringify(source.simulation.document, null, 2);

    expect(result).toMatchObject({
      ready: true,
      itemId: 'lesson-a',
      kind: 'lesson',
      moduleId: 'module-a',
      moduleTitle: 'Module A',
      importText,
      importTextSha256: createHash('sha256').update(importText).digest('hex'),
      baseItemHash: source.simulation.base.itemHash,
      proposedItemHash: source.simulation.proposedItemHash,
      bytes: Buffer.byteLength(importText, 'utf8'),
      studioUrl: 'https://academy.example.test/studio/courses/course-a',
      ownerScopeKey: source.ownerScopeKey,
      changeSummary: source.simulation.changeSummary,
    });
    expect(new URL(result.studioUrl).search).toBe('');
    expect(new URL(result.studioUrl).hash).toBe('');
    expect(result.steps).toHaveLength(8);
    expect(result.steps.map((step) => step.slice(0, 3))).toEqual(['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ']);
    expect(source.simulation.document).toEqual({ id: 'lesson-a', kind: 'lesson', title: 'Café' });
  });

  it('rejects an invalid simulation with its validation issues', () => {
    const errors = [{ code: 'E_PROFILE_LEVEL_RANGE', pointer: '/questions/0/level', message: 'Invalid level' }];
    expect(() => prepareImportPackage(input({ valid: false, errors }))).toThrowError(ImportPackageError);
    try {
      prepareImportPackage(input({ valid: false, errors }));
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED', issues: errors });
    }
    expect(() => prepareImportPackage(input({ valid: false }))).toThrowError(ImportPackageError);
  });

  it('reports an unsaveable base draft with its specific error code', () => {
    expect(() => prepareImportPackage(input({
      valid: false,
      errors: [{ code: 'BASE_DRAFT_UNSAVEABLE', pointer: '', message: 'The base draft cannot be saved' }],
    }))).toThrowError(expect.objectContaining({ code: 'BASE_DRAFT_UNSAVEABLE' }));
  });

  it('blocks pending review and oversized workspace envelopes', () => {
    expect(() => prepareImportPackage(input({ reviewPending: true }))).toThrowError(ImportPackageError);
    expect(() => prepareImportPackage(input({ reviewPending: true }))).toThrowError(expect.objectContaining({ code: 'REVIEW_PENDING' }));
    expect(prepareImportPackage(input({ workspaceBytes: 2 * 1024 * 1024 })).ready).toBe(true);
    expect(() => prepareImportPackage(input({ workspaceBytes: 2 * 1024 * 1024 + 1 }))).toThrowError(expect.objectContaining({ code: 'WORKSPACE_TOO_LARGE' }));
    expect(() => prepareImportPackage(input({
      valid: false,
      errors: [{ code: 'WORKSPACE_TOO_LARGE', pointer: '', message: 'The workspace is too large' }],
      workspaceBytes: 2 * 1024 * 1024 + 1,
    }))).toThrowError(expect.objectContaining({ code: 'WORKSPACE_TOO_LARGE' }));
  });

  it('enforces the 80 KiB limit on UTF-8 bytes of formatted import text', () => {
    const baseBytes = Buffer.byteLength(JSON.stringify({ id: 'lesson-a', kind: 'lesson', text: '' }, null, 2), 'utf8');
    const fitting = simulation({ id: 'lesson-a', kind: 'lesson', text: 'a'.repeat(LIMIT - baseBytes) });
    expect(Buffer.byteLength(fitting.importText, 'utf8')).toBe(LIMIT);
    expect(prepareImportPackage({ ...input(), simulation: fitting }).bytes).toBe(LIMIT);

    const oversized = simulation({ id: 'lesson-a', kind: 'lesson', text: 'é'.repeat((LIMIT - baseBytes) / 2 + 1) });
    expect(oversized.importText.length).toBeLessThan(LIMIT);
    expect(() => prepareImportPackage({ ...input(), simulation: oversized })).toThrowError(expect.objectContaining({ code: 'ITEM_TOO_LARGE_TO_PASTE' }));
  });

  it('warns on a moved draft and autosave after Apply', () => {
    const result = prepareImportPackage({ ...input(), baseDraftUpdatedAt: '2026-09-25T01:00:00.000Z' });
    expect(result.warnings.map((warning) => warning.code)).toContain('DRAFT_MOVED_ON');
    expect(result.warnings.map((warning) => warning.code)).toContain('AUTOSAVE_AFTER_APPLY');
    expect(prepareImportPackage({ ...input(), baseDraftUpdatedAt: '2026-09-26T01:00:00.000Z' }).warnings.map((warning) => warning.code)).not.toContain('DRAFT_MOVED_ON');
  });

  it.each([
    ['en', enMessages],
    ['vi', viMessages],
  ] as const)('uses current Studio labels in %s instructions', (uiLocale, messages) => {
    const result = prepareImportPackage({ ...input(), uiLocale });
    const labels = dialogMessages[uiLocale].import;
    expect(result.steps[0]).toContain(messages.studioWorkspace.readOnly);
    expect(result.steps[1]).toContain(messages.studioWorkspace.save);
    expect(result.steps[2]).toContain(`${messages.studioWorkspace.more} → ${messages.studioWorkspace.export}`);
    expect(result.steps[3]).toContain(`${messages.studioWorkspace.more} → ${labels.trigger} → ${labels.item}`);
    expect(result.steps[5]).toContain(replaceMessage(labels.replaceItem, { kind: uiLocale === 'vi' ? 'bài học' : 'lesson', id: 'lesson-a' }));
    expect(result.steps[6]).toContain(labels.apply);
    expect(result.steps[7]).toContain('verify_import');
    expect(result.steps[0]).toMatch(/^1\. Open /);
    expect(result.warnings.find((warning) => warning.code === 'AUTOSAVE_AFTER_APPLY')?.message)
      .toContain('Studio autosaves valid changes');
  });
});

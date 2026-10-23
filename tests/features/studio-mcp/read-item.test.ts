import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/studio-mcp/data/read-course', () => ({ readCourseState: vi.fn() }));

import { mcpGetItem } from '@/features/studio-mcp/data/read-item';
import { readCourseState } from '@/features/studio-mcp/data/read-course';
import type { ReadOnlyDatabase } from '@/features/studio-mcp/db/read-only-database';
import type { Actor } from '@/lib/permissions';

const actor = { userId: '11111111-1111-4111-8111-111111111111', roles: [] } as Actor;
const db = {} as ReadOnlyDatabase;
const original = {
  schemaVersion: 1, id: 'lesson-a', kind: 'lesson', title: 'Lesson',
  blocks: [{ id: 'quiz-a', type: 'quiz', questions: [{ id: 'q-a', type: 'single_choice', correctAnswer: 'a', settings: { feedback: { correctAnswer: 'secret' } } }] }],
};

function state(canEdit: boolean, document: unknown = original) {
  return {
    canEdit, ownerScopeKey: 'central', reviewPending: false,
    draft: {
      id: '11111111-1111-4111-8111-111111111112', courseId: 'course-a',
      manifest: { languages: ['en'], defaultLanguage: 'en', modules: [{ id: 'module-a', items: [{ id: 'lesson-a', type: 'lesson' }] }] },
      items: { 'lesson-a': document }, baseVersionId: null, checklist: {},
      updatedAt: '2026-09-26T00:00:00Z', revision: 'revision-a',
    },
  };
}

describe('get_item data path', () => {
  beforeEach(() => vi.mocked(readCourseState).mockResolvedValue(state(false)));

  it('resolves pointers only after redaction and hides the hash from readers', async () => {
    await expect(mcpGetItem(db, actor, 'course-a', 'lesson-a', '/blocks/0/questions/0/correctAnswer'))
      .rejects.toMatchObject({ code: 'POINTER_REDACTED' });
    await expect(mcpGetItem(db, actor, 'course-a', 'lesson-a', '/blocks/0/questions/0/settings/feedback/correctAnswer'))
      .rejects.toMatchObject({ code: 'POINTER_REDACTED' });

    const result = await mcpGetItem(db, actor, 'course-a', 'lesson-a');
    expect(result.redacted).toBe(true);
    expect(result).not.toHaveProperty('itemHash');
    expect(JSON.stringify(result.document)).not.toContain('secret');
  });

  it('returns a stable hash and source document only to course editors', async () => {
    vi.mocked(readCourseState).mockResolvedValue(state(true));
    const result = await mcpGetItem(db, actor, 'course-a', 'lesson-a');
    expect(result.itemHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.document).toEqual(original);
  });

  it('requires pointer mode for large items', async () => {
    vi.mocked(readCourseState).mockResolvedValue(state(false, { ...original, title: 'x'.repeat(50_000) }));
    await expect(mcpGetItem(db, actor, 'course-a', 'lesson-a'))
      .rejects.toMatchObject({ code: 'ITEM_TOO_LARGE_USE_POINTER' });
    const subtree = await mcpGetItem(db, actor, 'course-a', 'lesson-a', '/blocks/0/id');
    expect(subtree.document).toBe('quiz-a');
  });
});

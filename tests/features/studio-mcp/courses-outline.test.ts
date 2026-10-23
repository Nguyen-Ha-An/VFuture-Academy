import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { findDraftItem, outlineFromDraft, ownerScopeKey } from '@/features/studio-mcp/data/courses';
import { isCourseReviewPending } from '@/features/studio-mcp/data/read-course';
import type { ReadOnlyDatabase } from '@/features/studio-mcp/db/read-only-database';
import type { CourseDraft } from '@/features/studio/drafts';

const lesson = {
  schemaVersion: 1, kind: 'lesson', id: 'intro', title: { vi: 'Giới thiệu', en: 'Introduction' },
  blocks: [{ id: 'lesson-quiz', type: 'quiz', questions: [
    { id: 'q1', type: 'true_false' },
    { id: 'bank-q', $ref: 'published-question' },
    { id: 'group', type: 'question_group', questions: [{ id: 'q2', type: 'single_choice' }, { id: 'q3', type: 'numeric' }] },
  ] }],
};

const draft: CourseDraft = {
  id: '11111111-1111-4111-8111-111111111111', courseId: 'course-a',
  manifest: {
    id: 'course-a', kind: 'course', title: { vi: 'Khóa học', en: 'Course' },
    languages: ['vi', 'en'], defaultLanguage: 'vi',
    modules: [{ id: 'module-a', title: { vi: 'Mô-đun' }, items: [
      { id: 'intro', type: 'lesson', title: lesson.title },
      { id: 'exam-a', type: 'exam', title: 'Final exam' },
    ] }],
  },
  items: {
    intro: lesson,
    'exam-a': { schemaVersion: 1, kind: 'exam', id: 'exam-a', sections: [
      { id: 'section-a', timeLimitMinutes: 10, questions: [{ id: 'e1', type: 'essay' }, { $ref: 'bank:published' }, { $pool: { id: 'pool-a', count: 3 } }] },
    ] },
  },
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-26T00:00:00Z', revision: 'revision-a',
};

describe('course reader data', () => {
  it('fails closed when the pending-review read is malformed', async () => {
    const query = {
      select() { return query; }, eq() { return query; },
      limit() { return Promise.resolve({ data: null, error: null }); },
    };
    const db = { from: () => query } as unknown as ReadOnlyDatabase;
    await expect(isCourseReviewPending(db, 'course-a')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('locates only items declared in the course manifest', () => {
    expect(findDraftItem(draft, 'intro')).toMatchObject({ moduleId: 'module-a', kind: 'lesson', document: lesson });
    expect(findDraftItem({ ...draft, items: { ...draft.items, orphan: { id: 'orphan' } } }, 'orphan')).toBeNull();
  });

  it('shows outline counts without question text and omits hashes for readers', async () => {
    const reader = await outlineFromDraft(draft, false);
    expect(reader.modules[0].items[0]).toMatchObject({
      itemId: 'intro', kind: 'lesson', blockCount: 1,
      quizBlocks: [{ pointer: '/blocks/0', questionCount: 4, bankRefCount: 1 }],
    });
    expect(reader.modules[0].items[1]).toMatchObject({
      itemId: 'exam-a', examSections: [{ sectionId: 'section-a', pointer: '/sections/0', questionCount: 5, timed: true }],
    });
    expect(JSON.stringify(reader)).not.toContain('correctAnswer');
    expect(JSON.stringify(reader)).not.toContain('itemHash');

    const editor = await outlineFromDraft(draft, true);
    expect(editor.modules[0].items[0].itemHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ownerScopeKey({ ownership_kind: 'branch', owner_branch_id: 'branch-b' })).toBe('branch:branch-b');
  });

  it('provides a retrievable path through a maximum module count', async () => {
    const largeDraft: CourseDraft = {
      ...draft,
      manifest: {
        ...(draft.manifest as Record<string, unknown>),
        modules: Array.from({ length: 60 }, (_, moduleIndex) => ({
          id: `module-${moduleIndex}`, title: `Module ${moduleIndex}`,
          items: Array.from({ length: 60 }, (_, itemIndex) => ({
            id: `item-${moduleIndex}-${itemIndex}`, type: 'lesson', title: 'x'.repeat(120),
          })),
        })),
      },
      items: Object.fromEntries(Array.from({ length: 60 }, (_, moduleIndex) =>
        Array.from({ length: 60 }, (_, itemIndex) => [
          `item-${moduleIndex}-${itemIndex}`,
          { id: `item-${moduleIndex}-${itemIndex}`, kind: 'lesson', blocks: [] },
        ])).flat()),
    };
    const first = await outlineFromDraft(largeDraft, false);
    expect(first.moduleTotal).toBe(60);
    expect(first.modules).toHaveLength(1);
    expect(first.nextModuleOffset).toBe(1);
    expect(JSON.stringify(first).length).toBeLessThan(100_000);
    const second = await outlineFromDraft(largeDraft, false, { moduleOffset: 1, moduleLimit: 1 });
    expect(second.modules[0].moduleId).toBe('module-1');
    const targeted = await outlineFromDraft(largeDraft, false, { itemId: 'item-59-59' });
    expect(targeted.modules[0].items.map((item) => item.itemId)).toEqual(['item-59-59']);
  });
});

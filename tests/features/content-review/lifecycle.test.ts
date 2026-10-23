import { describe, expect, it } from 'vitest';

import { CONTENT_STAGES, contentEditorHref, contentStage, stageCounts } from '@/features/content-review/lifecycle';

describe('content lifecycle stage', () => {
  it('lets an open review decide the stage, whatever the content status', () => {
    for (const contentStatus of ['draft', 'published', 'archived'] as const) {
      expect(contentStage({ reviewStatus: 'pending', contentStatus })).toBe('in_review');
      expect(contentStage({ reviewStatus: 'changes_requested', contentStatus })).toBe('changes_requested');
      expect(contentStage({ reviewStatus: 'approved', contentStatus })).toBe('approved');
    }
  });

  it('counts stale and withdrawn reviews as draft', () => {
    expect(contentStage({ reviewStatus: 'stale', contentStatus: 'draft' })).toBe('draft');
    expect(contentStage({ reviewStatus: 'withdrawn', contentStatus: 'draft' })).toBe('draft');
    expect(contentStage({ reviewStatus: 'withdrawn', contentStatus: 'published' })).toBe('draft');
  });

  it('falls back to the content status without a live review', () => {
    expect(contentStage({ contentStatus: 'draft' })).toBe('draft');
    expect(contentStage({ reviewStatus: null, contentStatus: 'published' })).toBe('published');
    expect(contentStage({ reviewStatus: 'published', contentStatus: 'published' })).toBe('published');
    expect(contentStage({ reviewStatus: undefined, contentStatus: 'archived' })).toBe('archived');
  });

  it('counts every stage, zero-filled, in strip order', () => {
    const counts = stageCounts([
      { contentStatus: 'draft' },
      { reviewStatus: 'pending', contentStatus: 'draft' },
      { reviewStatus: 'pending', contentStatus: 'published' },
      { reviewStatus: 'approved', contentStatus: 'draft' },
      { reviewStatus: 'stale', contentStatus: 'draft' },
      { contentStatus: 'published' },
    ]);
    expect(Object.keys(counts)).toEqual([...CONTENT_STAGES]);
    expect(counts).toEqual({ draft: 2, in_review: 2, changes_requested: 0, approved: 1, published: 1, archived: 0 });
    expect(stageCounts([])).toEqual({ draft: 0, in_review: 0, changes_requested: 0, approved: 0, published: 0, archived: 0 });
  });
});

describe('contentEditorHref', () => {
  it('opens resource, opportunity and project editors instead of the narrowed library view', () => {
    expect(contentEditorHref('resource', 'guide one', '/studio/library?type=resource&id=guide one')).toBe('/studio/resources/guide%20one');
    expect(contentEditorHref('opportunity', 'o-1', '/studio/library?type=opportunity&id=o-1')).toBe('/studio/opportunities/o-1');
    expect(contentEditorHref('project', 'p-1', '/studio/library?type=project&id=p-1')).toBe('/studio/projects/p-1');
  });

  it('keeps other types and read-only learner links as given', () => {
    expect(contentEditorHref('course', 'c-1', '/studio/courses/c-1')).toBe('/studio/courses/c-1');
    expect(contentEditorHref('resource', 'r-1', '/app/resources/r-1')).toBe('/app/resources/r-1');
  });
});

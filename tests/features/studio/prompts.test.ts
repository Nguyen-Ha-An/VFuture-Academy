import { describe, expect, it, vi } from 'vitest';

import { FIXTURES } from '@/content-engine/fixtures';

vi.mock('server-only', () => ({}));

import { buildDraftPrompt } from '@/features/studio/prompts';

const draft = {
  id: 'draft-1',
  courseId: 'ai-foundations',
  manifest: FIXTURES['ai-foundations'].manifest,
  items: FIXTURES['ai-foundations'].items,
  baseVersionId: null,
  checklist: {},
  updatedAt: null,
};

describe('Studio prompt pack adapter', () => {
  it('builds an engine lesson prompt from a stored course and item document', () => {
    const prompt = buildDraftPrompt(draft, { kind: 'lesson', itemId: 'what-is-ai', locale: 'en' });

    expect(prompt).toContain('"id": "what-is-ai"');
    expect(prompt).toContain('Output contract');
  });

  it('builds a translation prompt for the requested stored document', () => {
    const prompt = buildDraftPrompt(draft, { kind: 'translate', itemId: 'what-is-ai', locale: 'en' });

    expect(prompt).toContain('Add "vi" translations');
    expect(prompt).toContain('"kind": "lesson"');
  });
});

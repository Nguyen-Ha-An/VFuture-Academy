import { describe, expect, it } from 'vitest';
import { profileContextFromDraft, staticProfileContext } from '@/content-engine/authoring/context';

describe('authoring context', () => {
  const draft = {
    manifest: {
      languages: ['vi', 'en'], defaultLanguage: 'vi',
      skills: [{ id: 'reasoning', name: 'Reasoning' }], tags: ['existing-tag'],
      relatedOpportunities: ['related-opportunity'],
      modules: [{ id: 'module-1', items: [
        { id: 'lesson-a', type: 'lesson' }, { id: 'exam-a', type: 'exam' },
        { id: 'assignment-a', type: 'assignment' },
      ] }],
    },
    items: {
      'lesson-a': {
        id: 'lesson-a', kind: 'lesson', blocks: [
          { id: 'image-1', type: 'image', src: { assetId: 'known-asset' }, alt: 'Known' },
          { id: 'quiz-1', type: 'quiz', questions: [{ $ref: 'bank:known-question' }] },
          { id: 'resource-1', type: 'resource_link', resourceId: 'known-resource' },
          { id: 'opportunity-1', type: 'opportunity_link', opportunityId: 'known-opportunity' },
          { id: 'link-1', type: 'next_step', target: { kind: 'url', url: 'https://example.org' } },
        ], tags: ['used-tag'],
      },
    },
  };

  it('collects only existing course values for reference enums', () => {
    const context = profileContextFromDraft(draft);
    expect(context.languageMode).toBe('bilingual');
    expect(context.assetIds).toEqual(['known-asset']);
    expect(context.bankRefs).toEqual(['bank:known-question']);
    expect(context.skills).toEqual(['reasoning']);
    expect(context.tagWhitelist).toEqual(['existing-tag', 'used-tag']);
    expect(context.resourceIds).toEqual(['known-resource']);
    expect(context.opportunityIds).toEqual(['known-opportunity', 'related-opportunity']);
    expect(context.itemTargets).toEqual({ lesson: ['lesson-a'], exam: ['exam-a'] });
    expect(context.existingItemIds).toEqual(['assignment-a', 'exam-a', 'lesson-a']);
    expect(context.knownUrls).toEqual(['https://example.org']);
  });

  it('supports default-only language and a fixed edit target', () => {
    const context = profileContextFromDraft(draft, { languagePolicy: 'default-only', target: { kind: 'lesson', id: 'lesson-a' } });
    expect(context.languageMode).toBe('default-only');
    expect(context.target).toEqual({ kind: 'lesson', id: 'lesson-a' });
  });

  it('forbids references in static artifacts', () => {
    const context = staticProfileContext('mono');
    expect(context.assetIds).toEqual([]);
    expect(context.bankRefs).toEqual([]);
    expect(context.resourceIds).toEqual([]);
    expect(context.opportunityIds).toEqual([]);
  });
});

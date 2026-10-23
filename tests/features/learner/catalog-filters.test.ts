import { describe, expect, it } from 'vitest';

import { parseCatalogFilters } from '@/features/learner/catalog-filters';

describe('learner catalog filter parsing', () => {
  it('keeps one supported value for every catalog filter', () => {
    expect(parseCatalogFilters({
      level: 'foundation',
      pathway: 'ai-emerging-technology',
      difficulty: 'beginner',
      language: 'en',
    })).toEqual({
      level: 'foundation',
      pathway: 'ai-emerging-technology',
      difficulty: 'beginner',
      language: 'en',
    });
  });

  it('ignores invalid and repeated query values instead of leaking them to the service', () => {
    expect(parseCatalogFilters({
      level: ['specialization', 'foundation'],
      pathway: 'not-a-pathway',
      difficulty: 'expert',
      language: 'fr',
    })).toEqual({});
  });
});

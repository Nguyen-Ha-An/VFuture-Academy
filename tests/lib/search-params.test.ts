import { describe, expect, it } from 'vitest';

import { compactSearchParams, filterStateKey, firstNonEmpty } from '@/lib/search-params';

describe('firstNonEmpty', () => {
  it('treats missing, empty and whitespace-only values as absent', () => {
    expect(firstNonEmpty(undefined)).toBeUndefined();
    expect(firstNonEmpty('')).toBeUndefined();
    expect(firstNonEmpty('   ')).toBeUndefined();
    expect(firstNonEmpty([])).toBeUndefined();
    expect(firstNonEmpty(['', ' '])).toBeUndefined();
  });

  it('returns the first non-empty value, trimmed', () => {
    expect(firstNonEmpty(' hackathon ')).toBe('hackathon');
    expect(firstNonEmpty(['', 'workshop', 'event'])).toBe('workshop');
  });
});

describe('compactSearchParams', () => {
  it('drops empty and whitespace-only entries and the page by default', () => {
    const form = new FormData();
    form.append('type', '');
    form.append('openNow', 'true');
    form.append('featured', '');
    form.append('search', '  ');
    form.append('page', '3');
    expect(compactSearchParams(form).toString()).toBe('openNow=true');
  });

  it('keeps repeated keys in order and honours a custom drop list', () => {
    const params = new URLSearchParams('tab=learning&skill=a&skill=b&page=2&level=');
    expect(compactSearchParams(params, ['tab']).toString()).toBe('skill=a&skill=b&page=2');
  });

  it('ignores file entries', () => {
    const form = new FormData();
    form.append('cover', new Blob(['x']), 'cover.png');
    form.append('status', 'active');
    expect(compactSearchParams(form).toString()).toBe('status=active');
  });
});

describe('filterStateKey', () => {
  it('is stable across key order and skips empty values', () => {
    const a = filterStateKey({ type: 'hackathon', openNow: true, featured: undefined, search: '' });
    const b = filterStateKey({ search: ' ', openNow: true, type: 'hackathon', page: null });
    expect(a).toBe('openNow=true&type=hackathon');
    expect(b).toBe(a);
  });

  it('keeps false, zero and repeated values', () => {
    expect(filterStateKey({ featured: false, page: 0, skill: ['b', 'a'] })).toBe('featured=false&page=0&skill=b&skill=a');
  });

  it('is empty for no filters', () => {
    expect(filterStateKey({})).toBe('');
  });
});

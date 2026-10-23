import { describe, it, expect } from 'vitest';
import { IdSchema, L10nStringSchema, MediaRefSchema, l10n, isLocaleMap } from '@/content-engine/schema/common';
import { z } from 'zod';

describe('IdSchema', () => {
  it.each(['a', 'lesson-1', 'q01', 'x'.repeat(64)])('accepts %s', (id) => expect(IdSchema.safeParse(id).success).toBe(true));
  it.each(['', 'Lesson', '-a', 'a_b', 'a b', 'x'.repeat(65), 'é'])('rejects %j', (id) => expect(IdSchema.safeParse(id).success).toBe(false));
});

describe('L10nStringSchema', () => {
  it('accepts plain strings and locale maps', () => {
    expect(L10nStringSchema.safeParse('Hello').success).toBe(true);
    expect(L10nStringSchema.safeParse({ vi: 'Xin chào', en: 'Hello' }).success).toBe(true);
    expect(L10nStringSchema.safeParse({ vi: 'Chỉ tiếng Việt' }).success).toBe(true);
  });
  it('rejects empty maps and unknown locales', () => {
    expect(L10nStringSchema.safeParse({}).success).toBe(false);
    expect(L10nStringSchema.safeParse({ fr: 'Bonjour' }).success).toBe(false);
  });
});

describe('l10n()', () => {
  const S = l10n(z.object({ blocks: z.array(z.string()) }).strict());
  it('accepts inner or a locale map of inner', () => {
    expect(S.safeParse({ blocks: ['a'] }).success).toBe(true);
    expect(S.safeParse({ vi: { blocks: [] }, en: { blocks: ['b'] } }).success).toBe(true);
    expect(S.safeParse({ vi: { nope: 1 } }).success).toBe(false);
  });
});

describe('MediaRefSchema', () => {
  it('accepts assetId or https url only', () => {
    expect(MediaRefSchema.safeParse({ assetId: 'asset_01' }).success).toBe(true);
    expect(MediaRefSchema.safeParse({ url: 'https://cdn.example.com/a.png' }).success).toBe(true);
    expect(MediaRefSchema.safeParse({ url: 'http://cdn.example.com/a.png' }).success).toBe(false);
    expect(MediaRefSchema.safeParse({ assetId: 'a', url: 'https://x.y/z' }).success).toBe(false);
  });
});

describe('isLocaleMap', () => {
  it('detects objects whose keys are all locales', () => {
    expect(isLocaleMap({ vi: 'a' })).toBe(true);
    expect(isLocaleMap({ vi: 'a', en: 'b' })).toBe(true);
    expect(isLocaleMap({ vi: 'a', blocks: [] })).toBe(false);
    expect(isLocaleMap({})).toBe(false);
    expect(isLocaleMap('vi')).toBe(false);
  });
});

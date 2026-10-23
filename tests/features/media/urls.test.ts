import { describe, expect, it } from 'vitest';
import { mediaHref } from '@/features/media/urls';

describe('mediaHref', () => {
  it('builds a media route and escapes an asset identifier as one path segment', () => {
    expect(mediaHref('asset/a b?')).toBe('/api/v1/media/asset%2Fa%20b%3F');
  });
});

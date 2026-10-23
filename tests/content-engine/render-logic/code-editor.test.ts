import { describe, it, expect } from 'vitest';
import { languageExtension } from '@/content-engine/render/CodeEditor';

describe('languageExtension', () => {
  it('returns a non-empty extension array for a known language', () => {
    expect(languageExtension('python').length).toBeGreaterThan(0);
  });
  it('returns an empty array for plaintext', () => {
    expect(languageExtension('plaintext')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveL10nString, localizeDeep } from '@/content-engine/compile/localize';

describe('resolveL10nString', () => {
  it('returns plain strings unchanged', () => expect(resolveL10nString('x', 'en', 'vi')).toBe('x'));
  it('prefers requested locale, then default, then any', () => {
    expect(resolveL10nString({ vi: 'a', en: 'b' }, 'en', 'vi')).toBe('b');
    expect(resolveL10nString({ vi: 'a' }, 'en', 'vi')).toBe('a');
    expect(resolveL10nString({ en: 'b' }, 'vi', 'vi')).toBe('b');
  });
});

describe('localizeDeep', () => {
  const doc = {
    title: { vi: 'Tiêu đề', en: 'Title' },
    content: { vi: { blocks: [{ type: 'paragraph', content: [{ text: 'xin chào' }] }] }, en: { blocks: [{ type: 'paragraph', content: [{ text: 'hello' }] }] } },
    options: [{ id: 'a', content: { blocks: [{ type: 'paragraph', content: [{ text: 'same' }] }] } }],
    correctAnswer: { vi: 'not-a-locale-map', en: 'still-not' },
    settings: { caseSensitive: false },
    points: 2,
  };
  it('flattens locale maps everywhere except correctAnswer/settings/display', () => {
    const out = localizeDeep(doc, 'en', 'vi') as typeof doc;
    expect(out.title).toBe('Title');
    expect((out.content as unknown as { blocks: unknown[] }).blocks).toHaveLength(1);
    expect(out.options[0].content).toEqual({ blocks: [{ type: 'paragraph', content: [{ text: 'same' }] }] });
    expect(out.correctAnswer).toEqual({ vi: 'not-a-locale-map', en: 'still-not' });
    expect(out.points).toBe(2);
  });
  it('falls back to the default locale', () => {
    const out = localizeDeep({ title: { vi: 'Chỉ Việt' } }, 'en', 'vi') as { title: string };
    expect(out.title).toBe('Chỉ Việt');
  });
  it('does not mutate the input', () => {
    const input = { title: { vi: 'a', en: 'b' } };
    localizeDeep(input, 'en', 'vi');
    expect(input.title).toEqual({ vi: 'a', en: 'b' });
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeText, stripAccents, parseNumber, wordCount } from '@/content-engine/grading/normalize';

describe('normalizeText', () => {
  it('trims, collapses whitespace, case-folds by default and keeps accents', () => {
    expect(normalizeText('  Hà   Nội ')).toBe('hà nội');
    expect(normalizeText('Hà Nội', { caseSensitive: true })).toBe('Hà Nội');
  });
  it('strips accents only when asked, including đ', () => {
    expect(normalizeText('Đà Nẵng', { ignoreAccents: true })).toBe('da nang');
    expect(stripAccents('Điện Biên Phủ')).toBe('Dien Bien Phu');
  });
  it('NFC-normalizes composed vs decomposed input', () => {
    expect(normalizeText('Hà Nội')).toBe(normalizeText('Hà Nội'));
  });
});

describe('parseNumber', () => {
  it.each([
    ['3.14', 3.14], ['3,14', 3.14], [' -2 ', -2], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1,234,567', 1234567], ['1e3', 1000], [4.5, 4.5], ['+7', 7], ['.5', 0.5],
  ])('parses %j → %d', (input, expected) => expect(parseNumber(input)).toBe(expected));
  it.each(['', 'abc', '3.1.4', null, undefined, {}, 'NaN', 'Infinity'])('rejects %j', (input) => expect(parseNumber(input)).toBeNull());
  it('treats comma as thousands separator when decimalComma is false', () => {
    expect(parseNumber('3,14', { decimalComma: false })).toBe(314);
  });
  it('treats dot-grouped thousands as one number but keeps a single dot decimal', () => {
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1.5')).toBe(1.5);
  });
});

describe('wordCount', () => {
  it('counts whitespace-separated words', () => {
    expect(wordCount('  Học sinh   viết bài  ')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

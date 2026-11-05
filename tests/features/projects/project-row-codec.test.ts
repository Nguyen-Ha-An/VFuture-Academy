import { describe, expect, it } from 'vitest';
import { memberFields, outputLinkFields, parseMembers, parseOutputLinks, serializeMemberFields, serializeOutputLinkFields } from '@/features/projects/ui/form-utils';

describe('recoverable project structured row codecs', () => {
  it.each([
    ['https://example.org/demo', ['', '', 'https://example.org/demo'], { label: { vi: 'example.org', en: 'example.org' }, url: 'https://example.org/demo' }],
    ['Demo | https://example.org/demo', ['Demo ', 'Demo ', ' https://example.org/demo'], { label: { vi: 'Demo', en: 'Demo' }, url: 'https://example.org/demo' }],
    ['Bản mẫu | Demo | https://example.org/demo', ['Bản mẫu ', ' Demo ', ' https://example.org/demo'], { label: { vi: 'Bản mẫu', en: 'Demo' }, url: 'https://example.org/demo' }],
    ['Bản mẫu |  | https://example.org/demo', ['Bản mẫu ', '  ', ' https://example.org/demo'], { label: { vi: 'Bản mẫu' }, url: 'https://example.org/demo' }],
  ] as const)('interprets legacy source, preserving editable whitespace and canonical API meaning: %s', (source, fields, expected) => {
    expect(outputLinkFields(source)).toEqual(fields);
    expect(parseOutputLinks(source)).toEqual([expected]);
    expect(parseOutputLinks(serializeOutputLinkFields(fields))).toEqual([expected]);
  });
  it('keeps exact editable labels containing delimiters, escapes, newlines and trailing spaces', () => {
    const fields = ['Mẫu | thử\\nghiệm\nDòng hai ', ' Demo | draft\\path\nNext ', 'https://example.org/demo'] as const;
    const source = serializeOutputLinkFields(fields);
    expect(source.split('\n')).toHaveLength(1);
    expect(outputLinkFields(source)).toEqual(fields);
    expect(parseOutputLinks(source)).toEqual([{ label: { vi: fields[0].trim(), en: fields[1].trim() }, url: fields[2] }]);
  });
  it('preserves one-language blank labels through the canonical API projection', () => {
    expect(parseOutputLinks(serializeOutputLinkFields(['', 'English only', 'https://example.org']))).toEqual([{ label: { en: 'English only' }, url: 'https://example.org' }]);
  });
  it('preserves sibling output rows when one encoded row changes', () => {
    const first = serializeOutputLinkFields(['Một | hai', 'One | two', 'https://one.example.org']);
    const legacy = 'Other | https://two.example.org';
    const fields = outputLinkFields(first);
    const edited = serializeOutputLinkFields([fields[0], 'Updated\nEnglish', fields[2]]);
    const result = `${edited}\n${legacy}`;
    expect(result.split('\n')[1]).toBe(legacy);
    expect(parseOutputLinks(result)[0]).toEqual({ label: { vi: 'Một | hai', en: 'Updated\nEnglish' }, url: 'https://one.example.org' });
    expect(parseOutputLinks(result)[1]).toEqual(parseOutputLinks(legacy)[0]);
  });
  it('keeps legacy member semantics and new raw editable text without inventing roles', () => {
    expect(memberFields(' user-1 | mentor ')).toEqual([' user-1 ', ' mentor ']);
    expect(parseMembers(' user-1 | mentor ')).toEqual([{ userId: 'user-1', role: 'mentor' }]);
    const fields = [' user|id\\path\nnext ', 'mentor'] as const;
    const source = serializeMemberFields(fields);
    expect(source.split('\n')).toHaveLength(1);
    expect(memberFields(source)).toEqual(fields);
    expect(parseMembers(source)).toEqual([{ userId: fields[0].trim(), role: 'mentor' }]);
    expect(parseMembers('user-1 | unsupported')).toEqual([{ userId: 'user-1', role: 'member' }]);
  });
  it('retains incomplete rows for parent validity checks instead of silently dropping them', () => {
    expect(parseMembers(serializeMemberFields(['', 'member']))).toEqual([{ userId: '', role: 'member' }]);
    expect(parseOutputLinks(serializeOutputLinkFields(['', '', '']))).toEqual([{ label: { vi: '', en: '' }, url: '' }]);
  });
});

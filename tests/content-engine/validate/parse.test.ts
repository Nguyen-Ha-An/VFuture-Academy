import { describe, it, expect } from 'vitest';
import { parseJsonDocument, offsetToPosition, pointerToRange, MAX_JSON_DEPTH } from '@/content-engine/validate/parse';

describe('parseJsonDocument', () => {
  it('parses valid JSON and exposes a tree', () => {
    const p = parseJsonDocument('{"a": [1, {"b": "c"}]}', 'd');
    expect(p.errors).toEqual([]);
    expect(p.value).toEqual({ a: [1, { b: 'c' }] });
    expect(pointerToRange(p, '/a/1/b')).toEqual({ start: { line: 1, col: 17 }, end: { line: 1, col: 20 } });
  });
  it('reports parse errors with line and column', () => {
    const p = parseJsonDocument('{\n  "a": 1,\n}', 'd');
    expect(p.errors[0]).toMatchObject({ code: 'E_JSON_PARSE', docId: 'd', range: { start: { line: 3, col: 1 } } });
    expect(p.errors[0].message.en).toMatch(/trailing comma|property name/i);
  });
  it('rejects documents over the size and depth limits', () => {
    expect(parseJsonDocument('x'.repeat(1_048_577), 'd').errors[0]).toMatchObject({ code: 'E_LIMIT_EXCEEDED', meta: { limit: 'bytes' } });
    expect(parseJsonDocument('['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1), 'd').errors[0]).toMatchObject({ code: 'E_LIMIT_EXCEEDED', meta: { limit: 'depth' } });
  });
  it('offsetToPosition is 1-based', () => {
    expect(offsetToPosition('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(offsetToPosition('ab\ncd', 3)).toEqual({ line: 2, col: 1 });
  });
});

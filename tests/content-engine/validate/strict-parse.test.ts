import { describe, it, expect } from 'vitest';

import {
  MAX_DOCUMENT_BYTES,
  pointerToRange,
  pointerTokens,
  MAX_ENVELOPE_BYTES,
  MAX_JSON_DEPTH,
  MAX_PARSE_DIAGNOSTICS,
  PositionIndex,
  documentSizeDiagnostics,
  parseJsonDocument,
  parseJsonEnvelope,
  utf8ByteLength,
} from '@/content-engine/validate/parse';
import { COURSE_REF, itemRef } from '@/content-engine/diagnostics';

const codes = (text: string, opts?: Parameters<typeof parseJsonDocument>[2]) =>
  parseJsonDocument(text, COURSE_REF, opts).errors.map((error) => error.code);

describe('strict parsing rejects rather than repairs', () => {
  it('accepts a valid object document and exposes the parsed value', () => {
    const parsed = parseJsonDocument('{"kind":"course","n":1}', COURSE_REF);
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toEqual({ kind: 'course', n: 1 });
  });

  it.each([
    ['a byte order mark', '﻿{"a":1}', 'byte order mark'],
    ['a markdown code fence', '```json\n{"a":1}\n```', 'markdown code fence'],
    ['a markup wrapper', '<result>{"a":1}</result>', 'markup wrapper'],
    ['prose around the document', 'Here is your JSON: {"a":1}', 'text around the JSON document'],
  ])('names %s instead of reporting a bare syntax error', (_label, text, detail) => {
    const [error] = parseJsonDocument(text, COURSE_REF).errors;
    expect(error).toMatchObject({ code: 'E_JSON_PARSE', meta: { detail } });
  });

  it.each([
    ['a comment', '{"a":1 /* nope */}'],
    ['a trailing comma', '{"a":1,}'],
    ['an unterminated object', '{"a":1'],
    ['a single-quoted key', "{'a':1}"],
  ])('rejects %s', (_label, text) => {
    const errors = codes(text);
    expect(errors.length).toBeGreaterThan(0);
    expect(new Set(errors)).toEqual(new Set(['E_JSON_PARSE']));
    expect(parseJsonDocument(text, COURSE_REF).value).toBeUndefined();
  });

  it('reports a duplicate key that JSON.parse would silently collapse', () => {
    // JSON.parse keeps the last value and destroys the evidence; the syntax tree
    // still has both, so this is where the author gets told.
    const text = '{\n  "id": "first",\n  "id": "second"\n}';
    expect(JSON.parse(text)).toEqual({ id: 'second' });
    const parsed = parseJsonDocument(text, COURSE_REF);
    expect(parsed.errors).toMatchObject([{ code: 'E_JSON_DUPLICATE_KEY', path: '/id', meta: { key: 'id' }, range: { start: { line: 3, col: 3 } } }]);
    // Nothing usable comes back: a repaired value could otherwise be persisted.
    expect(parsed.value).toBeUndefined();
  });

  it('detects duplicates by decoded key, not by raw spelling', () => {
    // "id" and "id" are the same property name once unescaped.
    expect(codes('{"id":"a","\\u0069d":"b"}')).toEqual(['E_JSON_DUPLICATE_KEY']);
  });

  it('finds duplicates nested inside arrays and objects', () => {
    const parsed = parseJsonDocument('{"modules":[{"items":[{"id":1,"id":2}]}]}', COURSE_REF);
    expect(parsed.errors).toMatchObject([{ code: 'E_JSON_DUPLICATE_KEY', path: '/modules/0/items/0/id' }]);
  });

  it('rejects a numeric literal that overflows to Infinity', () => {
    expect(JSON.parse('{"points":1e999}').points).toBe(Infinity);
    const parsed = parseJsonDocument('{"points":1e999}', COURSE_REF);
    expect(parsed.errors).toMatchObject([{ code: 'E_JSON_NUMBER_RANGE', path: '/points', meta: { received: '1e999' } }]);
    expect(parsed.value).toBeUndefined();
  });

  it.each([
    ['a string', '"just text"', 'string'],
    ['a number', '42', 'number'],
    ['null', 'null', 'null'],
    ['an array', '[{"kind":"course"}]', 'array'],
  ])('rejects %s at the document root', (_label, text, received) => {
    expect(parseJsonDocument(text, COURSE_REF).errors).toMatchObject([{ code: 'E_JSON_ROOT_NOT_OBJECT', meta: { received } }]);
  });

  it('allows a non-object root only where a caller explicitly asks for it', () => {
    expect(parseJsonDocument('[1,2]', COURSE_REF, { rootType: 'any' }).value).toEqual([1, 2]);
  });

  it('treats $schema as inert metadata, never as something to fetch', () => {
    const parsed = parseJsonDocument('{"$schema":"https://example.invalid/schema.json","kind":"course"}', COURSE_REF);
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toMatchObject({ $schema: 'https://example.invalid/schema.json' });
  });
});

describe('byte and depth limits', () => {
  it('measures the exact UTF-8 length, not the character count', () => {
    expect(utf8ByteLength('Tiếng Việt')).toBe(14);
    expect(utf8ByteLength('a')).toBe(1);
  });

  it('accepts a document at exactly the limit and rejects one byte more', () => {
    const pad = (bytes: number) => `{"a":"${'x'.repeat(bytes)}"}`;
    const exact = pad(MAX_DOCUMENT_BYTES - 8);
    expect(utf8ByteLength(exact)).toBe(MAX_DOCUMENT_BYTES);
    expect(parseJsonDocument(exact, COURSE_REF).errors).toEqual([]);

    const over = pad(MAX_DOCUMENT_BYTES - 7);
    expect(parseJsonDocument(over, COURSE_REF).errors).toMatchObject([
      { code: 'E_LIMIT_EXCEEDED', meta: { limit: 'bytes', received: MAX_DOCUMENT_BYTES + 1, expected: MAX_DOCUMENT_BYTES } },
    ]);
  });

  it('counts multi-byte characters against the byte limit', () => {
    // Each 'ế' is three bytes, so a string well under the character limit can still
    // be over the byte limit.
    const text = `{"a":"${'ế'.repeat(400_000)}"}`;
    expect(text.length).toBeLessThan(MAX_DOCUMENT_BYTES);
    expect(parseJsonDocument(text, COURSE_REF).errors).toMatchObject([{ code: 'E_LIMIT_EXCEEDED', meta: { limit: 'bytes' } }]);
  });

  it('gives an envelope the larger budget with identical strictness', () => {
    const items = Array.from({ length: 6 }, (_, i) => `"l${i}":{"pad":"${'x'.repeat(200_000)}"}`).join(',');
    const envelope = `{"manifest":{},"items":{${items}}}`;
    expect(utf8ByteLength(envelope)).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expect(utf8ByteLength(envelope)).toBeLessThan(MAX_ENVELOPE_BYTES);

    expect(parseJsonDocument(envelope, COURSE_REF).errors).toMatchObject([{ code: 'E_LIMIT_EXCEEDED' }]);
    expect(parseJsonEnvelope(envelope, COURSE_REF).errors).toEqual([]);
    // Still strict: the bigger budget buys size, not tolerance.
    expect(parseJsonEnvelope('{"a":1,"a":2}', COURSE_REF).errors).toMatchObject([{ code: 'E_JSON_DUPLICATE_KEY' }]);
  });

  it('rejects an envelope over the envelope limit', () => {
    const text = `{"pad":"${'x'.repeat(MAX_ENVELOPE_BYTES)}"}`;
    expect(parseJsonEnvelope(text, COURSE_REF).errors).toMatchObject([
      { code: 'E_LIMIT_EXCEEDED', meta: { limit: 'bytes', expected: MAX_ENVELOPE_BYTES } },
    ]);
  });

  it('holds each document inside an envelope to the per-document limit', () => {
    const big = { pad: 'x'.repeat(1_100_000) };
    const diagnostics = documentSizeDiagnostics({ id: 'c' }, { small: { a: 1 }, huge: big });
    expect(diagnostics).toMatchObject([{ code: 'E_LIMIT_EXCEEDED', docId: 'huge', meta: { expected: MAX_DOCUMENT_BYTES } }]);
  });

  it('rejects nesting past the depth limit', () => {
    const deep = '['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1);
    expect(parseJsonDocument(deep, COURSE_REF, { rootType: 'any' }).errors).toMatchObject([
      { code: 'E_LIMIT_EXCEEDED', meta: { limit: 'depth', received: MAX_JSON_DEPTH + 1 } },
    ]);
    const atLimit = '['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH);
    expect(parseJsonDocument(atLimit, COURSE_REF, { rootType: 'any' }).errors).toEqual([]);
  });

  it('ignores brackets that only appear inside strings', () => {
    expect(parseJsonDocument(`{"a":"${'['.repeat(200)}"}`, COURSE_REF).errors).toEqual([]);
  });
});

describe('bounded work and output on hostile input', () => {
  it('caps the diagnostics from a densely duplicated document and stops walking', () => {
    // 40k duplicate keys: without a cap this produced 40k diagnostics, and rescanning
    // for each one made a 1 MiB document quadratic.
    const duplicates = Array.from({ length: 40_000 }, () => '"id":1').join(',');
    const text = `{${duplicates}}`;
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);

    const started = Date.now();
    const parsed = parseJsonDocument(text, COURSE_REF);
    const elapsed = Date.now() - started;

    expect(parsed.errors).toHaveLength(MAX_PARSE_DIAGNOSTICS);
    expect(parsed.errors.every((error) => error.code === 'E_JSON_DUPLICATE_KEY')).toBe(true);
    expect(parsed.errors.at(-1)?.meta).toMatchObject({ truncated: MAX_PARSE_DIAGNOSTICS });
    expect(parsed.value).toBeUndefined();
    expect(elapsed).toBeLessThan(5_000);
  });

  it('reports at most five syntax errors from a badly broken document', () => {
    expect(parseJsonDocument(`{${'"a":,'.repeat(200)}}`, COURSE_REF).errors.length).toBeLessThanOrEqual(5);
  });
});

describe('PositionIndex', () => {
  it('is 1-based and resolves positions across lines', () => {
    const index = new PositionIndex('ab\ncd\n\nef');
    expect(index.at(0)).toEqual({ line: 1, col: 1 });
    expect(index.at(3)).toEqual({ line: 2, col: 1 });
    expect(index.at(6)).toEqual({ line: 3, col: 1 });
    expect(index.at(7)).toEqual({ line: 4, col: 1 });
  });

  it('clamps out-of-range offsets instead of producing nonsense', () => {
    const index = new PositionIndex('ab');
    expect(index.at(-5)).toEqual({ line: 1, col: 1 });
    expect(index.at(99)).toEqual({ line: 1, col: 3 });
  });

  it('agrees with a naive scan on every offset of a multi-line document', () => {
    const text = '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n';
    const naive = (offset: number) => {
      let line = 1, col = 1;
      for (let i = 0; i < offset && i < text.length; i++) { if (text[i] === '\n') { line++; col = 1; } else col++; }
      return { line, col };
    };
    const index = new PositionIndex(text);
    for (let offset = 0; offset <= text.length; offset++) expect(index.at(offset)).toEqual(naive(offset));
  });
});

describe('document references survive parsing', () => {
  it('keeps an item named "manifest" distinct from the course document', () => {
    const item = parseJsonDocument('{"a":1,"a":2}', itemRef('manifest'));
    expect(item.errors[0]).toMatchObject({ ref: { kind: 'item', id: 'manifest' }, docId: 'manifest' });
    const course = parseJsonDocument('{"a":1,"a":2}', COURSE_REF);
    expect(course.errors[0]).toMatchObject({ ref: { kind: 'course' }, docId: 'manifest' });
  });

  it('runs without Buffer, so the same parser works in a browser', () => {
    const buffer = globalThis.Buffer;
    // @ts-expect-error deliberately removing a Node global for this assertion
    delete globalThis.Buffer;
    try {
      expect(parseJsonDocument('{"a":1}', COURSE_REF).errors).toEqual([]);
      expect(utf8ByteLength('Tiếng Việt')).toBe(14);
    } finally {
      globalThis.Buffer = buffer;
    }
  });
});

describe('pointer resolution reads each token in context', () => {
  const at = (text: string, pointer: string) => {
    const parsed = parseJsonDocument(text, COURSE_REF, { rootType: 'any' });
    const range = pointerToRange(parsed, pointer);
    return range && text.slice(indexOf(text, range.start.line, range.start.col), indexOf(text, range.end.line, range.end.col));
  };
  const indexOf = (text: string, line: number, col: number) => {
    const lines = text.split('\n');
    return lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + col - 1;
  };

  it('keeps numeric-looking object keys distinct, including a leading zero', () => {
    // "01" and "1" are different properties. Treating either token as an array index
    // found neither, and the diagnostic about them lost its clickable source range.
    const text = '{"answers":{"01":"A","1":"B"}}';
    expect(at(text, '/answers/01')).toBe('"A"');
    expect(at(text, '/answers/1')).toBe('"B"');
  });

  it('still resolves array indices', () => {
    const text = '{"items":["zero","one","two"]}';
    expect(at(text, '/items/0')).toBe('"zero"');
    expect(at(text, '/items/2')).toBe('"two"');
    expect(at(text, '/items/3')).toBeUndefined();
    // A non-canonical index is not an array position.
    expect(at(text, '/items/01')).toBeUndefined();
  });

  it('decodes ~1 and ~0 in keys and matches nothing else', () => {
    const text = '{"a/b":{"c~d":1},"plain":2}';
    expect(at(text, '/a~1b/c~0d')).toBe('1');
    expect(at(text, '/a/b')).toBeUndefined();
  });

  it('resolves the whole document for the empty pointer and mixed paths', () => {
    const text = '{"modules":[{"items":[{"id":"x"}]}]}';
    expect(at(text, '')).toBe(text);
    expect(at(text, '/modules/0/items/0/id')).toBe('"x"');
    expect(at(text, '/modules/0/items/1/id')).toBeUndefined();
  });

  it('does not descend into a scalar', () => {
    expect(at('{"a":1}', '/a/b')).toBeUndefined();
  });

  it('exposes exact tokens, preserving leading zeros', () => {
    expect(pointerTokens('/answers/01')).toEqual(['answers', '01']);
    expect(pointerTokens('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(pointerTokens('')).toEqual([]);
  });

  it('attaches a range to a diagnostic about a numeric-looking key', () => {
    const text = '{\n  "answers": {\n    "01": 1,\n    "01": 2\n  }\n}';
    const parsed = parseJsonDocument(text, COURSE_REF);
    expect(parsed.errors).toMatchObject([{ code: 'E_JSON_DUPLICATE_KEY', path: '/answers/01' }]);
    expect(pointerToRange({ ...parsed, errors: [] }, '/answers/01')).toBeDefined();
  });
});

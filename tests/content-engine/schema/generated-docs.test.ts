import { describe, expect, it } from 'vitest';
import { EmbeddedSchemaBlockError, standaloneContentSchema } from '@/content-engine/schema/json-schema';
import { formatJsonCompact, listJsonFences, schemaFingerprint, withGeneratedBlocks } from '@/content-engine/schema/generated-docs';

/**
 * The AI quiz kit is prose the author owns plus JSON the generator owns. Every fenced
 * JSON block sits under a marker naming its source, and the generator rewrites only the
 * fenced bodies — so an example in the kit can never drift from the fixture that CI
 * validates, and a fence with no marker is a fence nobody validates.
 */
const schema = { $schema: 'https://example.test', anyOf: [] };
const sources: Record<string, string> = {
  'examples/one.json': JSON.stringify({ id: 'one', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Xin chào' }] }] } }),
};
const read = (path: string) => { if (!(path in sources)) throw new Error(`missing ${path}`); return sources[path]; };

const kit = [
  '# Kit', '',
  'Phiên bản schema: <!-- generated: schema-fingerprint -->`stale`.', '',
  'Prose before.', '',
  '<!-- generated: examples/one.json -->',
  '```json', '{"old": true}', '```', '',
  '<!-- generated: examples/one.json compact -->',
  '```json', '{"old": true}', '```', '',
  '## JSON Schema đầy đủ', '',
  '<!-- generated: standalone-schema -->',
  '```json', '{}', '```', '',
  'Prose after.', '',
].join('\n');

describe('formatJsonCompact', () => {
  it('keeps small containers on one line and breaks large ones', () => {
    const text = formatJsonCompact({ id: 'a', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Hi' }] }] }, options: Array.from({ length: 6 }, (_, i) => ({ id: `option-${i}`, content: { blocks: [{ type: 'paragraph', content: [{ text: `Lựa chọn số ${i} khá dài để không nằm gọn một dòng` }] }] } })) }, 100);
    const lines = text.split('\n');
    expect(lines[0]).toBe('{');
    expect(text).toContain('"content": { "blocks": [{ "type": "paragraph", "content": [{ "text": "Hi" }] }] }');
    expect(lines.some((line) => line.length > 100 && !line.includes('"text"'))).toBe(false);
    expect(lines.filter((line) => line.trim().startsWith('{ "id": "option-')).length).toBe(6);
  });

  it.each([
    [{ a: 1, b: [1, 2, { c: null }], d: 'x' }],
    [[]],
    [{}],
    [{ deep: { deeper: { deepest: Array.from({ length: 40 }, (_, i) => ({ i, text: 'y'.repeat(30) })) } } }],
    ['plain string with "quotes" and \\n escapes'],
    [{ unicode: 'Tiếng Việt — có dấu', emoji: '✓' }],
  ])('round-trips %j', (value) => {
    expect(JSON.parse(formatJsonCompact(value, 80))).toEqual(value);
  });
});

describe('schemaFingerprint', () => {
  it('is twelve lowercase hex characters and stable', () => {
    expect(schemaFingerprint()).toMatch(/^[0-9a-f]{12}$/);
    expect(schemaFingerprint()).toBe(schemaFingerprint(standaloneContentSchema()));
  });
  it('changes when the schema changes', () => {
    expect(schemaFingerprint({ ...standaloneContentSchema(), title: 'other' })).not.toBe(schemaFingerprint());
  });
});

describe('withGeneratedBlocks', () => {
  it('rewrites every marked fence and the fingerprint, and nothing else', () => {
    const { text, changed, blocks } = withGeneratedBlocks(kit, { schema, read });
    expect(changed).toBe(true);
    expect(blocks).toEqual(['schema-fingerprint', 'examples/one.json', 'examples/one.json compact', 'standalone-schema']);
    expect(text).toContain(`Phiên bản schema: <!-- generated: schema-fingerprint -->\`${schemaFingerprint(schema)}\`.`);
    expect(text).toContain('<!-- generated: examples/one.json -->\n```json\n' + JSON.stringify(JSON.parse(sources['examples/one.json']), null, 2) + '\n```');
    expect(text).toContain('<!-- generated: examples/one.json compact -->\n```json\n' + formatJsonCompact(JSON.parse(sources['examples/one.json'])) + '\n```');
    expect(text).toContain('<!-- generated: standalone-schema -->\n```json\n' + JSON.stringify(schema, null, 2) + '\n```');
    // Prose is untouched: strip every fenced body and the fingerprint value from both sides and compare.
    const prose = (markdown: string) => markdown.replace(/```json\n[\s\S]*?\n```/g, '```json\n…\n```').replace(/-->`[^`]*`/g, '-->`…`');
    expect(prose(text)).toBe(prose(kit));
  });

  it('is idempotent', () => {
    const once = withGeneratedBlocks(kit, { schema, read }).text;
    const twice = withGeneratedBlocks(once, { schema, read });
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });

  it('refuses a marker with no fence, an unknown source, or an unterminated fence', () => {
    expect(() => withGeneratedBlocks('<!-- generated: examples/one.json -->\n\nprose\n', { schema, read })).toThrow(EmbeddedSchemaBlockError);
    expect(() => withGeneratedBlocks('<!-- generated: nope.json -->\n```json\n{}\n```\n', { schema, read })).toThrow(/nope\.json/);
    expect(() => withGeneratedBlocks('<!-- generated: standalone-schema -->\n```json\n{}\n', { schema, read })).toThrow(EmbeddedSchemaBlockError);
  });

  it('refuses a marked fence whose source is not valid JSON', () => {
    expect(() => withGeneratedBlocks('<!-- generated: examples/one.json -->\n```json\n{}\n```\n', { schema, read: () => '{ nope' })).toThrow(/examples\/one\.json/);
  });

  it('still rewrites a legacy document that only has the "## JSON Schema" heading', () => {
    const legacy = '# Old kit\n\n## JSON Schema đầy đủ\n\n```json\n{}\n```\n';
    const { text, changed } = withGeneratedBlocks(legacy, { schema, read });
    expect(changed).toBe(true);
    expect(text).toBe('# Old kit\n\n## JSON Schema đầy đủ\n\n```json\n' + JSON.stringify(schema, null, 2) + '\n```\n');
  });
});

describe('listJsonFences', () => {
  it('reports each fenced JSON block and whether a marker owns it', () => {
    const fences = listJsonFences('<!-- generated: a.json -->\n```json\n{}\n```\n\nprose\n\n```json\n{"unowned": true}\n```\n');
    expect(fences).toEqual([
      { line: 2, source: 'a.json' },
      { line: 8, source: null },
    ]);
  });
});

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { authoringJsonSchema, staticProfileContext } from '@/content-engine/authoring';
import { authoringSchemaSlice } from '@/features/studio-mcp/data/schema-slice';

describe('bounded MCP authoring schema', () => {
  it('splits large lesson and question group schemas into retrievable parts', () => {
    const context = staticProfileContext('mono');
    const index = authoringSchemaSlice({ kind: 'lesson', context, part: 'index' });
    const document = authoringSchemaSlice({ kind: 'lesson', context, part: 'document' });
    const group = authoringSchemaSlice({ kind: 'lesson', context, part: 'question:question_group' });
    for (const result of [index, document, group]) {
      expect(result.schema.length).toBeLessThanOrEqual(20_000);
      expect(result.bytes).toBe(result.schema.length);
      expect(JSON.parse(result.schema)).toHaveProperty('$schema');
    }
    expect(document.includedDefs.length).toBeGreaterThan(0);
    expect(document.omittedDefs.length).toBeGreaterThan(0);
    expect(group.omittedDefs.length).toBeGreaterThan(0);

    const definition = authoringSchemaSlice({
      kind: 'lesson', context, part: `def:${group.omittedDefs[0]}`,
      questionTypes: ['question_group'],
    });
    expect(definition.schema.length).toBeLessThanOrEqual(20_000);
    expect(definition.includedDefs).toContain(group.omittedDefs[0]);

    const assembled = JSON.parse(group.schema) as Record<string, unknown>;
    const defs = assembled.$defs as Record<string, unknown>;
    for (const name of group.omittedDefs) {
      const part = authoringSchemaSlice({ kind: 'lesson', context, part: `def:${name}`, questionTypes: ['question_group'] });
      Object.assign(defs, (JSON.parse(part.schema) as { $defs: Record<string, unknown> }).$defs);
    }
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    expect(() => ajv.compile(assembled)).not.toThrow();
  });

  it('pages one oversized per-course definition without losing its exact values', () => {
    const context = staticProfileContext('mono');
    context.assetIds = Array.from({ length: 1_500 }, (_, index) => `asset-${String(index).padStart(4, '0')}`);
    const full = authoringJsonSchema('lesson', context);
    const defs = full.$defs as Record<string, unknown>;
    const name = Object.keys(defs).find((key) => JSON.stringify(defs[key]).length > 19_500);
    expect(name).toBeDefined();
    const first = authoringSchemaSlice({ kind: 'lesson', context, part: `def:${name}` });
    expect(first.definitionChunk?.count).toBeGreaterThan(1);
    const chunks = Array.from({ length: first.definitionChunk!.count }, (_, index) => {
      const part = authoringSchemaSlice({ kind: 'lesson', context, part: `def:${name}@${index}` });
      expect(part.schema.length).toBeLessThanOrEqual(20_000);
      return (JSON.parse(part.schema) as { 'x-definitionChunkBase64': string })['x-definitionChunkBase64'];
    });
    expect(JSON.parse(Buffer.from(chunks.join(''), 'base64').toString('utf8'))).toEqual(defs[name!]);
  });
});

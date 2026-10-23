import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportJsonSchemas } from '@/content-engine/schema/json-schema';
import { SCHEMAS_BY_KIND } from '@/content-engine/schema/document';
import { InMemoryResolver, validateWorkspace } from '@/content-engine/validate';

const schemaDir = join(process.cwd(), 'docs', 'studio', 'content-schema');
const supportedKinds = ['course', 'lesson', 'exam', 'assignment'] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

describe('Studio content schema documentation', () => {
  it('parses every documented example with its runtime schema', () => {
    for (const kind of supportedKinds) {
      const example = readJson(join(schemaDir, 'examples', `${kind}.json`));
      const result = SCHEMAS_BY_KIND[kind].safeParse(example);
      expect(result.success, `${basename(`${kind}.json`)} should parse`).toBe(true);
    }
  });

  it('validates the complete course example as a Studio workspace', async () => {
    const manifest = readJson(join(schemaDir, 'examples', 'course.json'));
    const report = await validateWorkspace({ manifest, items: {} }, new InMemoryResolver({}));

    expect(report.errors).toEqual([]);
  });

  it('keeps documented schema snapshots in sync with the exporter', () => {
    const exported = exportJsonSchemas();
    for (const kind of supportedKinds) {
      const expected = { ...exported[kind] };
      delete expected.$id;
      expect(readJson(join(schemaDir, `${kind}.json`))).toEqual(expected);
    }
  });

  it('keeps the root schema refs pointed at the supported Studio schemas', () => {
    expect(readJson(join(schemaDir, 'content.schema.json'))).toMatchObject({
      oneOf: supportedKinds.map((kind) => ({ $ref: `./${kind}.json` })),
    });
  });
});

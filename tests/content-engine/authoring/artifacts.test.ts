import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_IMPLEMENTATION_BASELINE, AUTHORING_IMPLEMENTATION_FILES,
  AUTHORING_STORAGE_BASELINE, authoringProfileVersion, authoringSchemaArtifacts,
} from '@/content-engine/authoring/fingerprint';
import { schemaFingerprint } from '@/content-engine/schema/generated-docs';
import { AUTHORING_EXAMPLES } from '@/content-engine/authoring/guide';
import { AUTHORING_GUIDE_TOPICS, authoringGuideTopic, schemaForAuthoring, staticProfileContext } from '@/content-engine/authoring';
import { validateDocument } from '@/content-engine/validate/structural';

describe('authoring public artifacts', () => {
  it('pins the reviewed storage schema', () => {
    expect(AUTHORING_STORAGE_BASELINE).toBe('6fc10dd988ac');
    expect(schemaFingerprint()).toBe(AUTHORING_STORAGE_BASELINE);
  });

  it('pins implementation behavior, including semantic and legacy passes', () => {
    const hash = createHash('sha256');
    for (const path of AUTHORING_IMPLEMENTATION_FILES) {
      hash.update(path).update('\0').update(readFileSync(path)).update('\0');
    }
    expect(hash.digest('hex').slice(0, 12)).toBe(AUTHORING_IMPLEMENTATION_BASELINE);
  });

  it('exports six item schemas, 26 question slices, rules and an index', () => {
    const artifacts = authoringSchemaArtifacts();
    expect(artifacts).toHaveLength(34);
    expect(new Set(artifacts.map((artifact) => artifact.path)).size).toBe(34);
    expect(artifacts.map((artifact) => artifact.path)).toContain('public/schemas/v1/authoring/mono/lesson.json');
    expect(artifacts.map((artifact) => artifact.path)).toContain('public/schemas/v1/authoring/bilingual/question_group.json');
    expect(artifacts.map((artifact) => artifact.path)).toContain('public/schemas/v1/authoring/index.json');
    expect(authoringProfileVersion()).toMatch(/^mcp-authoring-v1\+[a-f0-9]{12}$/);
  });

  it('has checked-in bytes matching the generator and no ambiguous anyOf', () => {
    for (const artifact of authoringSchemaArtifacts()) {
      expect(readFileSync(artifact.path, 'utf8'), artifact.path).toBe(artifact.text);
      expect(JSON.stringify(artifact.value), artifact.path).not.toContain('"anyOf"');
    }
  });

  it('keeps artifact ids, fingerprints and byte sizes in the index accurate', () => {
    const artifacts = authoringSchemaArtifacts();
    const index = artifacts.find((entry) => entry.path.endsWith('/index.json'))!;
    const rows = index.value.artifacts as Array<{ path: string; fingerprint: string; bytes: number }>;
    expect(rows).toHaveLength(33);
    for (const artifact of artifacts) {
      const relative = artifact.path.slice('public/schemas/v1/authoring/'.length);
      expect(artifact.value.$id, artifact.path).toBe(`https://academy.vfuturelabs.org/schemas/v1/authoring/${relative}`);
      if (artifact === index) continue;
      const row = rows.find((entry) => entry.path === relative);
      expect(row, artifact.path).toBeDefined();
      expect(row?.fingerprint).toBe(createHash('sha256').update(JSON.stringify(artifact.value)).digest('hex').slice(0, 12));
      expect(row?.bytes).toBe(Buffer.byteLength(artifact.text, 'utf8'));
    }
  });

  it('compiles every published schema under strict draft 2020-12 validation', () => {
    for (const artifact of authoringSchemaArtifacts().filter((entry) => !/(rules|index)\.json$/.test(entry.path))) {
      const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
      addFormats(ajv);
      expect(() => ajv.compile(artifact.value), artifact.path).not.toThrow();
    }
  }, 60_000);

  it('keeps generated guide examples valid for Studio storage', () => {
    for (const [kind, document] of Object.entries(AUTHORING_EXAMPLES)) {
      const path = `docs/studio/content-schema/authoring/examples/${kind}.json`;
      expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(document, null, 2)}\n`);
      expect(validateDocument(document, `${kind}-example`).ok).toBe(true);
      expect(schemaForAuthoring(kind as 'lesson' | 'exam' | 'assignment', staticProfileContext('mono')).safeParse(document).success).toBe(true);
    }
  });

  it('keeps guide topics and leaf question slices within response budgets', () => {
    for (const topic of AUTHORING_GUIDE_TOPICS) expect(authoringGuideTopic(topic)!.length, topic).toBeLessThanOrEqual(12_000);
    for (const artifact of authoringSchemaArtifacts()) {
      if (!/(mono|bilingual)\/(single_choice|multiple_choice|true_false|fill_blank|short_answer|numeric|matching|ordering|classification|essay|upload_answer|code_answer)\.json$/.test(artifact.path)) continue;
      expect(JSON.stringify(artifact.value).length, artifact.path).toBeLessThanOrEqual(20_000);
    }
  });
});

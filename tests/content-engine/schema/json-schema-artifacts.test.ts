import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { SCHEMAS_BY_KIND } from '@/content-engine/schema/document';
import {
  embeddedSchemaProse, EmbeddedSchemaBlockError, embeddedStandaloneSchema,
  schemaArtifacts, standaloneContentSchema, STUDIO_KINDS, withEmbeddedStandaloneSchema,
  type SchemaArtifact,
} from '@/content-engine/schema/json-schema';
import { GENERATED_DOCS, listJsonFences, schemaFingerprint, withGeneratedBlocks } from '@/content-engine/schema/generated-docs';

/**
 * Compiling these schemas is genuinely slow — `course.json` is about 1.4 MB — and the
 * 5 s default is not enough once this file runs alongside the rest of the suite.
 */
const AJV_TIMEOUT_MS = 60_000;

const root = process.cwd();
const readText = (path: string) => readFileSync(join(root, ...path.split('/')), 'utf8');
const readJson = (path: string) => JSON.parse(readText(path)) as Record<string, unknown>;

const EXAMPLES = {
  course: ['course'],
  lesson: ['lesson', 'quiz-lesson', 'skeleton-lesson-quiz'],
  exam: ['exam', 'quiz-exam', 'code-exam', 'skeleton-exam'],
  assignment: ['assignment'],
} as const satisfies Record<(typeof STUDIO_KINDS)[number], readonly string[]>;

const example = (name: string) => readJson(`docs/studio/content-schema/examples/${name}.json`);

/**
 * Deliberately unforgiving: no coercion, no defaults written into the data, no removal
 * of unknown properties. A validator that quietly repaired its input would report the
 * schemas as stricter than they are.
 */
function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: true });
  addFormats(ajv);
  return ajv;
}

let artifacts: SchemaArtifact[];
beforeAll(() => { artifacts = schemaArtifacts(); });

describe('generated schema artifacts', () => {
  it('generates every checked-in schema file, byte for byte', () => {
    // This is `npm run schema:check` in-process: a source change that nobody exported
    // fails here rather than shipping a stale published schema.
    const stale = artifacts.filter((artifact) => {
      let current: string | null = null;
      try { current = readText(artifact.path); } catch { current = null; }
      return current !== artifact.text;
    }).map((artifact) => artifact.path);
    expect(stale, 'run `npm run schema:export`').toEqual([]);
  });

  it('covers the public endpoints, the Studio folder and the standalone bundle', () => {
    const paths = artifacts.map((artifact) => artifact.path);
    for (const kind of ['course', 'lesson', 'exam', 'assignment', 'question_bundle', 'resource']) {
      expect(paths).toContain(`public/schemas/v1/${kind}.json`);
    }
    for (const kind of STUDIO_KINDS) expect(paths).toContain(`docs/studio/content-schema/${kind}.json`);
    expect(paths).toContain('docs/studio/content-schema/content.schema.json');
    expect(paths).toContain('docs/studio/content-schema/content-standalone.schema.json');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('compiles every generated artifact as draft 2020-12', () => {
    for (const artifact of artifacts) {
      if (artifact.path.endsWith('content.schema.json')) continue; // relative refs, covered separately
      expect(() => makeAjv().compile(artifact.value as AnySchema), artifact.path).not.toThrow();
    }
  }, AJV_TIMEOUT_MS);
});

describe('standalone bundle', () => {
  it('resolves every reference inside itself', () => {
    const bundle = standaloneContentSchema();
    const defs = (bundle.$defs ?? {}) as Record<string, unknown>;
    const external: string[] = [];
    const missing: string[] = [];

    const walk = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node !== 'object' || node === null) return;
      const row = node as Record<string, unknown>;
      const ref = row.$ref;
      // `$ref` is also a legitimate authored property name in this content format, so
      // only a string value at a schema position is a JSON Schema reference.
      if (typeof ref === 'string') {
        if (!ref.startsWith('#/$defs/')) external.push(ref);
        else if (!Object.hasOwn(defs, ref.slice('#/$defs/'.length))) missing.push(ref);
      }
      for (const value of Object.values(row)) walk(value);
    };
    walk(bundle);

    expect(external, 'the bundle must travel alone').toEqual([]);
    expect(missing).toEqual([]);
  });

  it('offers one branch per Studio payload kind', () => {
    const bundle = standaloneContentSchema();
    expect(Array.isArray(bundle.anyOf)).toBe(true);
    expect((bundle.anyOf as unknown[]).length).toBe(STUDIO_KINDS.length);
  });
});

describe('strictness', () => {
  /** Every object that names its properties must also close the door on the rest. */
  const openObjects = (schema: unknown, path = ''): string[] => {
    if (Array.isArray(schema)) return schema.flatMap((node, index) => openObjects(node, `${path}/${index}`));
    if (typeof schema !== 'object' || schema === null) return [];
    const row = schema as Record<string, unknown>;
    const found: string[] = [];
    if (row.type === 'object' && typeof row.properties === 'object' && row.additionalProperties !== false && row.unevaluatedProperties !== false) {
      found.push(path || '/');
    }
    for (const [key, value] of Object.entries(row)) found.push(...openObjects(value, `${path}/${key}`));
    return found;
  };

  it('closes every representable object in every artifact', () => {
    for (const artifact of artifacts) {
      if (artifact.path.endsWith('content.schema.json')) continue;
      expect(openObjects(artifact.value), artifact.path).toEqual([]);
    }
  });

  it('rejects an unknown field in a documented example', () => {
    const ajv = makeAjv();
    const perKind = ajv.compile(readJson('public/schemas/v1/exam.json') as AnySchema);
    const bundle = makeAjv().compile(standaloneContentSchema() as AnySchema);
    const tampered = { ...example('quiz-exam'), notAField: true };

    expect(perKind(tampered)).toBe(false);
    expect(bundle(tampered)).toBe(false);
  }, AJV_TIMEOUT_MS);
});

describe('documented examples', () => {
  const cases = Object.entries(EXAMPLES).flatMap(([kind, names]) => names.map((name) => [kind as keyof typeof EXAMPLES, name] as const));

  let bundleValidate: ValidateFunction;
  const perKind = new Map<string, ValidateFunction>();
  beforeAll(() => {
    bundleValidate = makeAjv().compile(standaloneContentSchema() as AnySchema);
    for (const kind of STUDIO_KINDS) perKind.set(kind, makeAjv().compile(readJson(`public/schemas/v1/${kind}.json`) as AnySchema));
  }, AJV_TIMEOUT_MS);

  it.each(cases)('%s example "%s" satisfies its published schema', (kind, name) => {
    const validate = perKind.get(kind)!;
    const data = example(name);
    expect(validate(data), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
  });

  it.each(cases)('%s example "%s" satisfies the standalone bundle identically', (_kind, name) => {
    const data = example(name);
    expect(bundleValidate(data), JSON.stringify(bundleValidate.errors?.slice(0, 3))).toBe(true);
  });

  it.each(cases)('%s example "%s" also parses with the runtime Zod schema', (kind, name) => {
    expect(SCHEMAS_BY_KIND[kind].safeParse(example(name)).success).toBe(true);
  });

  it('never mutates the data it validates', () => {
    // Guards the coercion/defaults/removeAdditional settings: several nested schemas
    // carry Zod `.default()`s, and a validator writing them back would silently change
    // an author's document on the way through.
    const data = example('course');
    const before = JSON.stringify(data);
    expect(perKind.get('course')!(data)).toBe(true);
    expect(bundleValidate(data)).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('folder entry point', () => {
  it('resolves its relative refs against the sibling schema files', () => {
    const ajv = makeAjv();
    for (const kind of STUDIO_KINDS) {
      const schema = readJson(`docs/studio/content-schema/${kind}.json`);
      ajv.addSchema(schema as AnySchema, `${kind}.json`);
    }
    const validate = ajv.compile(readJson('docs/studio/content-schema/content.schema.json') as AnySchema);
    expect(validate(example('lesson'))).toBe(true);
    expect(validate({ schemaVersion: 1, kind: 'lesson' })).toBe(false);
  }, AJV_TIMEOUT_MS);
});

describe('generated documents (the AI quiz kit)', () => {
  const docs = GENERATED_DOCS.map((path) => [path, readText(path)] as const);
  const read = (source: string) => readText(source);

  it.each(docs)('%s needs no rewrite', (_path, markdown) => {
    // In-process `schema:check` for the kit: a fixture or schema change nobody
    // re-exported would leave the kit teaching a generator something Studio rejects.
    expect(withGeneratedBlocks(markdown, { read }).changed).toBe(false);
  });

  it.each(docs)('%s has no JSON fence that nobody generates', (_path, markdown) => {
    expect(listJsonFences(markdown).filter((fence) => fence.source === null)).toEqual([]);
  });

  it.each(docs)('%s carries the current schema and its fingerprint', (_path, markdown) => {
    const { blocks } = withGeneratedBlocks(markdown, { read });
    expect(blocks).toContain('standalone-schema');
    expect(blocks).toContain('schema-fingerprint');
    expect(markdown).toContain(`\`${schemaFingerprint()}\``);
    expect(embeddedStandaloneSchema(markdown)).toEqual(standaloneContentSchema());
  });

  it.each(docs)('%s shows every question type and every documented example', (_path, markdown) => {
    const { blocks } = withGeneratedBlocks(markdown, { read });
    for (const type of ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'numeric', 'matching', 'ordering', 'classification', 'essay', 'upload_answer', 'code_answer', 'question_group']) {
      expect(blocks).toContain(`docs/studio/content-schema/examples/questions/${type}.json compact`);
    }
    for (const name of ['quiz-exam', 'quiz-lesson', 'code-exam']) expect(blocks).toContain(`docs/studio/content-schema/examples/${name}.json`);
  });
});

describe('legacy single-block documents', () => {
  const markdown = '# Guide\n\n## JSON Schema đầy đủ\n\n```json\n' + JSON.stringify(standaloneContentSchema(), null, 2) + '\n```\n';

  it('embeds the current standalone bundle', () => {
    expect(embeddedStandaloneSchema(markdown)).toEqual(standaloneContentSchema());
    expect(withEmbeddedStandaloneSchema(markdown).changed).toBe(false);
  });

  it('keeps every byte of prose when the block is rewritten', () => {
    const rewritten = withEmbeddedStandaloneSchema(markdown, { $schema: 'https://example.test', anyOf: [] });
    expect(rewritten.changed).toBe(true);
    // The only thing that may move is the fenced body.
    expect(embeddedSchemaProse(rewritten.text)).toEqual(embeddedSchemaProse(markdown));
    expect(embeddedStandaloneSchema(rewritten.text)).toEqual({ $schema: 'https://example.test', anyOf: [] });
    expect(withEmbeddedStandaloneSchema(rewritten.text).text).toBe(markdown);
  });

  it('detects drift rather than only reporting a missing file', () => {
    const stale = withEmbeddedStandaloneSchema(markdown, { ...standaloneContentSchema(), title: 'stale' }).text;
    expect(withEmbeddedStandaloneSchema(stale).changed).toBe(true);
  });

  it.each([
    ['no heading to anchor to', '# Guide\n\n```json\n{}\n```\n'],
    ['no fence after the heading', '## JSON Schema\n\nprose only\n'],
    ['an unterminated fence', '## JSON Schema\n\n```json\n{}\n'],
  ])('refuses to guess when there is %s', (_label, text) => {
    expect(() => withEmbeddedStandaloneSchema(text)).toThrow(EmbeddedSchemaBlockError);
  });

  it('anchors on the last heading, so prose above it can move freely', () => {
    const text = [
      '## JSON Schema mentioned in passing', '', 'Prose that names the section.', '',
      '## JSON Schema đầy đủ', '', '```json', '{}', '```', '',
    ].join('\n');
    const rewritten = withEmbeddedStandaloneSchema(text, { ok: true });
    expect(embeddedStandaloneSchema(rewritten.text)).toEqual({ ok: true });
    expect(rewritten.text).toContain('## JSON Schema mentioned in passing');
  });
});

describe('schema metadata for authors', () => {
  /**
   * The bundle is what an author (or an AI the author briefs) reads to learn the
   * format. A definition called `__schema57` with no description teaches nothing; a
   * definition called `Option` that says "content is RichContent, never a plain
   * string" prevents the single most common rejected import.
   */
  const NAMED_DEFS = [
    'Id', 'L10nString', 'RichContent', 'L10nRichContent', 'TextRun', 'Option', 'Rubric',
    'SingleChoiceQuestion', 'MultipleChoiceQuestion', 'TrueFalseQuestion', 'FillBlankQuestion',
    'ShortAnswerQuestion', 'NumericQuestion', 'MatchingQuestion', 'OrderingQuestion',
    'ClassificationQuestion', 'EssayQuestion', 'UploadAnswerQuestion', 'CodeAnswerQuestion',
    'QuestionGroup', 'QuizBlock', 'QuizSettings', 'ExamSettings', 'ExamSection', 'ManifestItem',
    'CourseDocument', 'LessonDocument', 'ExamDocument', 'AssignmentDocument',
  ] as const;

  const defsOf = (schema: Record<string, unknown>) => (schema.$defs ?? {}) as Record<string, Record<string, unknown>>;

  it('names every definition in the standalone bundle', () => {
    const anonymous = Object.keys(defsOf(standaloneContentSchema())).filter((key) => /^__schema\d+$/.test(key));
    expect(anonymous).toEqual([]);
  });

  it('names every definition in every published artifact', () => {
    for (const artifact of artifacts) {
      if (artifact.path.endsWith('content.schema.json')) continue;
      const anonymous = Object.keys(defsOf(artifact.value)).filter((key) => /^__schema\d+$/.test(key));
      expect(anonymous, artifact.path).toEqual([]);
    }
  });

  it.each(NAMED_DEFS)('describes %s', (name) => {
    const def = defsOf(standaloneContentSchema())[name];
    expect(def, `missing $defs.${name}`).toBeDefined();
    expect(typeof def.description).toBe('string');
    expect((def.description as string).length).toBeGreaterThan(20);
  });

  it('explains the answer key on the field itself', () => {
    const single = defsOf(standaloneContentSchema()).SingleChoiceQuestion;
    const correctAnswer = (single.properties as Record<string, Record<string, unknown>>).correctAnswer;
    expect(String(correctAnswer.description)).toMatch(/option id/i);
    expect(String(correctAnswer.description)).not.toMatch(/index/i);
  });

  it('keeps the definitions the kit prose refers to stable', () => {
    // The kit's wrong→right table and error table name these; renaming one silently
    // breaks the prose without breaking any validator.
    const defs = defsOf(standaloneContentSchema());
    for (const name of NAMED_DEFS) expect(Object.hasOwn(defs, name), name).toBe(true);
  });
});

import { z } from 'zod';
import { DOCUMENT_KINDS, type DocumentKind } from './common';
import { SCHEMAS_BY_KIND } from './document';
import { SCHEMA_METADATA } from './metadata';

export const SCHEMA_BASE_URL = 'https://academy.vfuturelabs.org/schemas/v1';

/**
 * The course-authoring bundle: the payloads a course author hands to Studio as one
 * content document. `question_bundle` and `resource` are authored too — by the Studio
 * bank and resource editors — and get their own published schema at
 * `public/schemas/v1`; they are simply not part of this bundle's scope.
 */
export const STUDIO_KINDS = ['course', 'lesson', 'exam', 'assignment'] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];

/**
 * `io: 'input'` because these schemas describe what an author writes, not what the
 * engine hands back.
 *
 * `unrepresentable: 'any'` governs the parts JSON Schema cannot express. It does not
 * loosen a schema wholesale: types, enums, lengths, patterns, required keys and
 * `additionalProperties: false` are all still exported. What it drops is the
 * cross-field predicate inside a `.refine()`, which has no JSON Schema equivalent and
 * is therefore omitted rather than exported. The surrounding object stays exactly as
 * strict as it can be, and the dropped predicate stays a runtime check — which is why
 * passing JSON Schema validation is necessary but never sufficient. See
 * `RUNTIME_ONLY_RULES`.
 */
const TO_JSON_SCHEMA = {
  target: 'draft-2020-12',
  io: 'input',
  unrepresentable: 'any',
  cycles: 'ref',
  // Only named definitions become `$defs`; everything else is written where it is used.
  // Extracting every reused instance produced anonymous `__schemaN` entries (and, under a
  // refined schema, one for every leaf), which no author can read.
  reused: 'inline',
  metadata: SCHEMA_METADATA,
} as const;

const STANDALONE_TITLE = 'VFuture Studio content payload v1';
const STANDALONE_DESCRIPTION =
  'A complete course with inline items, or a standalone lesson, exam, or assignment. All schema references are contained in this file. Runtime validation is still required for semantic rules.';

/**
 * Constraints the content engine enforces that JSON Schema cannot express. Published
 * with the schemas so a generator that satisfies the schema still knows what it has
 * not been checked against.
 */
export const RUNTIME_ONLY_RULES = [
  'Ids are unique within their own namespace — modules, items and skills within the manifest; blocks within a lesson; sections within an exam; questions within one quiz or exam scope; options, blanks, categories and ordering items within their own list — and every item declared in the manifest has a document.',
  'Answer keys point at ids that exist in the same question (options, blanks, categories, ordering items).',
  'References to assets, question banks, resources, skills and opportunities must resolve.',
  'Locale maps must cover the course default language.',
  'Media and embed URLs must be on an allowed host.',
  'Every question type must be supported by the renderer the document targets.',
  'Regex short-answer patterns must compile in the bounded, non-backtracking engine.',
] as const;

export function exportJsonSchemas(): Record<DocumentKind, Record<string, unknown>> {
  const out = {} as Record<DocumentKind, Record<string, unknown>>;
  for (const kind of DOCUMENT_KINDS) {
    const js = hoistRootDefinition(z.toJSONSchema(SCHEMAS_BY_KIND[kind], TO_JSON_SCHEMA) as Record<string, unknown>);
    out[kind] = { ...js, $id: `${SCHEMA_BASE_URL}/${kind}.json`, title: `VFuture Academy ${kind} document v1` };
  }
  return out;
}

/**
 * A named document schema is exported by Zod as `{ $ref: '#/$defs/ExamDocument', $defs }`.
 * The per-kind files have always described the document at the root — `properties`,
 * `required`, `additionalProperties` at the top level — and consumers read them that
 * way, so the root definition is lifted back up and any reference to it becomes `#`.
 */
export function hoistRootDefinition(schema: Record<string, unknown>): Record<string, unknown> {
  const ref = schema.$ref;
  const defs = schema.$defs as Record<string, unknown> | undefined;
  if (typeof ref !== 'string' || !ref.startsWith('#/$defs/') || !defs) return schema;
  const name = ref.slice('#/$defs/'.length);
  const root = defs[name] as Record<string, unknown> | undefined;
  if (!root) return schema;
  const { [name]: _hoisted, ...rest } = defs;
  const { $ref: _ref, $defs: _defs, ...envelope } = schema;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (typeof node !== 'object' || node === null) return node;
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, value]) =>
      [key, key === '$ref' && value === ref ? '#' : rewrite(value)]));
  };
  const hoisted = { ...envelope, ...(rewrite(root) as Record<string, unknown>) };
  return Object.keys(rest).length ? { ...hoisted, $defs: rewrite(rest) } : hoisted;
}

/**
 * One file that resolves on its own. The per-kind schemas next to it use relative
 * `$ref`s, which only work when the whole folder travels together; an author pasting a
 * single schema into a generator has no folder. Every `$ref` here is a local pointer
 * into this document's own `$defs`.
 */
export function standaloneContentSchema(): Record<string, unknown> {
  const union = z.union(STUDIO_KINDS.map((kind) => SCHEMAS_BY_KIND[kind]));
  const js = z.toJSONSchema(union, TO_JSON_SCHEMA) as Record<string, unknown>;
  return { ...js, title: STANDALONE_TITLE, description: STANDALONE_DESCRIPTION };
}

/** Folder entry point. Relative `$ref`s, so the reader needs the sibling files. */
export function contentEntrySchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'VFuture Studio content payload v1',
    description: 'One complete course or a standalone lesson, exam, or assignment. Course items can be inline.',
    oneOf: STUDIO_KINDS.map((kind) => ({ $ref: `./${kind}.json` })),
  };
}

export interface SchemaArtifact {
  /** Repository-relative, forward-slashed. */
  path: string;
  value: Record<string, unknown>;
  /** Exactly the bytes the checked-in file must contain. */
  text: string;
}

const PUBLIC_DIR = 'public/schemas/v1';
const STUDIO_DIR = 'docs/studio/content-schema';

/**
 * Every generated schema file, built in memory. `schema:export` writes these and
 * `schema:check` compares them; both read this one function, so a checked-in artifact
 * cannot drift from the generator without the check noticing.
 */
export function schemaArtifacts(): SchemaArtifact[] {
  const artifacts: SchemaArtifact[] = [];
  const exported = exportJsonSchemas();

  for (const kind of DOCUMENT_KINDS) {
    const schema = exported[kind];
    // Historic formatting, kept so regeneration is a no-op diff: public files have no
    // trailing newline, docs files do.
    artifacts.push({ path: `${PUBLIC_DIR}/${kind}.json`, value: schema, text: JSON.stringify(schema, null, 2) });
    if ((STUDIO_KINDS as readonly string[]).includes(kind)) {
      const local = { ...schema };
      delete local.$id; // relative to the folder it ships in, so no absolute identity
      artifacts.push({ path: `${STUDIO_DIR}/${kind}.json`, value: local, text: `${JSON.stringify(local, null, 2)}\n` });
    }
  }

  const entry = contentEntrySchema();
  artifacts.push({ path: `${STUDIO_DIR}/content.schema.json`, value: entry, text: `${JSON.stringify(entry, null, 2)}\n` });
  const standalone = standaloneContentSchema();
  artifacts.push({ path: `${STUDIO_DIR}/content-standalone.schema.json`, value: standalone, text: `${JSON.stringify(standalone, null, 2)}\n` });

  return artifacts;
}

/**
 * The older single-block form of a generated document: prose that ends with one fenced
 * copy of the standalone bundle under a `## JSON Schema` heading. The AI quiz kit now
 * marks every generated block explicitly (see `generated-docs.ts`); this remains as the
 * fallback for a document that has no markers at all.
 */
const SCHEMA_HEADING = /^## JSON Schema[^\n]*$/gm;
const FENCE_OPEN = '```json\n';
const FENCE_CLOSE = '\n```';

export class EmbeddedSchemaBlockError extends Error {}

/**
 * Locates the fenced block by its heading rather than by position, so an author can
 * add, reorder or translate prose above it freely. The last matching heading wins:
 * the schema appendix is the final section in both documents.
 */
function embeddedBlockBounds(markdown: string): { start: number; end: number } {
  const heading = [...markdown.matchAll(SCHEMA_HEADING)].at(-1);
  if (heading?.index === undefined) throw new EmbeddedSchemaBlockError('no "## JSON Schema" heading to anchor the embedded block');
  const open = markdown.indexOf(FENCE_OPEN, heading.index);
  if (open === -1) throw new EmbeddedSchemaBlockError('no ```json fence after the "## JSON Schema" heading');
  const start = open + FENCE_OPEN.length;
  const end = markdown.indexOf(FENCE_CLOSE, start);
  if (end === -1) throw new EmbeddedSchemaBlockError('embedded ```json fence is never closed');
  return { start, end };
}

/**
 * Replaces the embedded schema with the current standalone bundle and leaves
 * everything else byte for byte.
 */
export function withEmbeddedStandaloneSchema(markdown: string, schema = standaloneContentSchema()): { text: string; changed: boolean } {
  const { start, end } = embeddedBlockBounds(markdown);
  const body = JSON.stringify(schema, null, 2);
  if (markdown.slice(start, end) === body) return { text: markdown, changed: false };
  return { text: `${markdown.slice(0, start)}${body}${markdown.slice(end)}`, changed: true };
}

/** The schema an embedded block currently holds, for drift checks and tests. */
export function embeddedStandaloneSchema(markdown: string): unknown {
  const { start, end } = embeddedBlockBounds(markdown);
  return JSON.parse(markdown.slice(start, end)) as unknown;
}

/** The prose either side of the embedded block — what a rewrite must never change. */
export function embeddedSchemaProse(markdown: string): { before: string; after: string } {
  const { start, end } = embeddedBlockBounds(markdown);
  return { before: markdown.slice(0, start), after: markdown.slice(end) };
}

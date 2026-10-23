import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmbeddedSchemaBlockError, standaloneContentSchema, withEmbeddedStandaloneSchema } from './json-schema';

/**
 * Documents that mix hand-written prose with generated JSON: the AI quiz kit.
 *
 * Every fenced JSON block in such a document sits under a marker naming where its
 * content comes from, and `schema:export` rewrites only those fenced bodies. The prose
 * is the author's and is never touched; the JSON is the generator's and can never
 * drift from the fixture or schema that CI validates. A fence with no marker is a fence
 * nobody validates, which `listJsonFences` exists to catch.
 *
 * Node-only (filesystem, hashing): imported by the export script and tests, never by
 * the content engine barrel that ships to the browser.
 */
export const GENERATED_DOCS = ['docs/studio/content-schema/QUIZ-AI-INSTRUCTIONS.md'] as const;

/** Marker forms: `<!-- generated: <source> -->` and `<!-- generated: <source> compact -->`. */
const MARKER = /<!-- generated: ([^\s>]+)( compact)? -->/g;
const FENCE_OPEN = '```json\n';
const FENCE_CLOSE = '\n```';
const SCHEMA_SOURCE = 'standalone-schema';
const FINGERPRINT_SOURCE = 'schema-fingerprint';

export const COMPACT_WIDTH = 100;

/** First twelve hex digits of the SHA-256 of the canonical bundle — the kit's version stamp. */
export function schemaFingerprint(schema: Record<string, unknown> = standaloneContentSchema()): string {
  return createHash('sha256').update(JSON.stringify(schema), 'utf8').digest('hex').slice(0, 12);
}

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] => typeof value === 'object' && value !== null;

/**
 * "Small" means structurally small, regardless of how long its strings are: an object
 * with at most eight keys, an array of at most one container or up to twelve primitives,
 * and everything inside them small too. A question stem's rich content is small; a list
 * of four options is not.
 */
function small(value: unknown): boolean {
  if (!isContainer(value)) return true;
  if (Array.isArray(value)) {
    if (!value.every(small)) return false;
    return value.some(isContainer) ? value.length <= 1 : value.length <= 12;
  }
  const entries = Object.values(value);
  return entries.length <= 8 && entries.every(small);
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[${value.map(inline).join(', ')}]` : '[]';
  if (isContainer(value)) {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

function render(value: unknown, indent: number, width: number): string {
  const single = inline(value);
  if (!isContainer(value) || small(value) || indent + single.length <= width) return single;
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${pad}${render(item, indent + 2, width)}`).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value).map(([key, item]) => {
    const label = `${JSON.stringify(key)}: `;
    return `${pad}${label}${render(item, indent + 2 + label.length, width)}`;
  });
  return `{\n${entries.join(',\n')}\n${close}}`;
}

/**
 * JSON that reads like the output an author should produce: one line per structurally
 * small value, multi-line only where a list genuinely has several entries. The kit's
 * fully pretty-printed examples are three times longer than they need to be and teach a
 * generator to be verbose; this teaches it to be compact without inventing a format.
 * Round-trips exactly through `JSON.parse`.
 */
export function formatJsonCompact(value: unknown, width = COMPACT_WIDTH): string {
  return render(value, 0, width);
}

export interface GeneratedBlocksOptions {
  schema?: Record<string, unknown>;
  /** Reads a marked source by its repository-relative path. Defaults to the working directory. */
  read?: (path: string) => string;
}

export interface GeneratedBlocksResult {
  text: string;
  changed: boolean;
  /** Marker sources rewritten, in document order. */
  blocks: string[];
}

const defaultRead = (path: string): string => readFileSync(join(process.cwd(), ...path.split('/')), 'utf8');

function sourceBody(source: string, compact: boolean, opts: Required<GeneratedBlocksOptions>): string {
  if (source === SCHEMA_SOURCE) return JSON.stringify(opts.schema, null, 2);
  let text: string;
  try { text = opts.read(source); } catch (cause) {
    throw new EmbeddedSchemaBlockError(`cannot read generated source ${source}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    throw new EmbeddedSchemaBlockError(`generated source ${source} is not valid JSON`);
  }
  return compact ? formatJsonCompact(value) : JSON.stringify(value, null, 2);
}

/**
 * Rewrites every marked block from its source and leaves the rest of the document byte
 * for byte. A document with no markers at all is treated as the older single-block form
 * and handled by its `## JSON Schema` heading.
 */
export function withGeneratedBlocks(markdown: string, options: GeneratedBlocksOptions = {}): GeneratedBlocksResult {
  const opts: Required<GeneratedBlocksOptions> = { schema: options.schema ?? standaloneContentSchema(), read: options.read ?? defaultRead };
  const markers = [...markdown.matchAll(MARKER)];
  if (!markers.length) {
    const legacy = withEmbeddedStandaloneSchema(markdown, opts.schema);
    return { text: legacy.text, changed: legacy.changed, blocks: [SCHEMA_SOURCE] };
  }

  let out = '';
  let cursor = 0;
  let changed = false;
  const blocks: string[] = [];
  for (const marker of markers) {
    const at = marker.index ?? 0;
    const source = marker[1];
    const compact = marker[2] !== undefined;
    const markerEnd = at + marker[0].length;
    out += markdown.slice(cursor, markerEnd);

    if (source === FINGERPRINT_SOURCE) {
      // The stamp is inline: the marker is immediately followed by a `backticked` value.
      if (markdown[markerEnd] !== '`') throw new EmbeddedSchemaBlockError('schema-fingerprint marker must be followed by a `value`');
      const end = markdown.indexOf('`', markerEnd + 1);
      if (end === -1) throw new EmbeddedSchemaBlockError('schema-fingerprint value is never closed');
      const current = markdown.slice(markerEnd + 1, end);
      const next = schemaFingerprint(opts.schema);
      if (current !== next) changed = true;
      out += `\`${next}\``;
      cursor = end + 1;
      blocks.push(source);
      continue;
    }

    // The fence must be the next thing after the marker, blank lines aside.
    const between = markdown.slice(markerEnd, markerEnd + 64);
    const gap = /^\s*/.exec(between)?.[0] ?? '';
    const open = markerEnd + gap.length;
    if (!markdown.startsWith(FENCE_OPEN, open)) throw new EmbeddedSchemaBlockError(`no \`\`\`json fence after the marker for ${source}`);
    const start = open + FENCE_OPEN.length;
    const end = markdown.indexOf(FENCE_CLOSE, start);
    if (end === -1) throw new EmbeddedSchemaBlockError(`the \`\`\`json fence for ${source} is never closed`);
    const body = sourceBody(source, compact, opts);
    if (markdown.slice(start, end) !== body) changed = true;
    out += markdown.slice(markerEnd, start) + body;
    cursor = end;
    blocks.push(compact ? `${source} compact` : source);
  }
  out += markdown.slice(cursor);
  return { text: out, changed, blocks };
}

export interface JsonFence {
  /** 1-based line of the ```json opener. */
  line: number;
  /** The marker source that owns this fence, or null when nobody generates it. */
  source: string | null;
}

/** Every fenced JSON block in a document, with the marker that owns it, if any. */
export function listJsonFences(markdown: string): JsonFence[] {
  const fences: JsonFence[] = [];
  const opener = /(^|\n)```json\n/g;
  for (const match of markdown.matchAll(opener)) {
    const at = (match.index ?? 0) + match[1].length;
    const line = markdown.slice(0, at).split('\n').length;
    const before = markdown.slice(0, at).trimEnd();
    const owner = /<!-- generated: ([^\s>]+)( compact)? -->$/.exec(before);
    fences.push({ line, source: owner ? `${owner[1]}${owner[2] ?? ''}` : null });
  }
  return fences;
}

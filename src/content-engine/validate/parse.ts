import { parse as lenientParse, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import { COURSE_REF, itemRef, makeDiagnostic, toRef, refLabel, type Diagnostic, type DocumentRef, type Position, type Range } from '../diagnostics';

/** One content document. Independent of, and smaller than, the envelope limit. */
export const MAX_DOCUMENT_BYTES = 1_048_576;

/**
 * A workspace backup or recovery envelope holds a manifest plus every item document,
 * so it is legitimately larger than any single one of them. It gets the same strict
 * treatment — depth, duplicate keys, non-finite numbers, no repair — with a bigger
 * byte budget, and the documents inside it are still checked against
 * `MAX_DOCUMENT_BYTES` individually.
 */
export const MAX_ENVELOPE_BYTES = 2_097_152;

export const MAX_JSON_DEPTH = 64;

/**
 * A document with tens of thousands of duplicate keys is still a rejected document
 * after the first hundred reports. Capping keeps both the work and the response
 * bounded on hostile input; `meta.truncated` says the list is not exhaustive.
 */
export const MAX_PARSE_DIAGNOSTICS = 100;

export interface ParseOptions {
  /** Content documents are objects; `'any'` is only for envelopes that legitimately are not. */
  rootType?: 'object' | 'any';
  /** Byte budget for this text. Defaults to one document's `MAX_DOCUMENT_BYTES`. */
  maxBytes?: number;
}

export interface ParsedDocument { ref: DocumentRef; docId: string; text: string; value: unknown; tree?: Node; errors: Diagnostic[] }

const encoder = new TextEncoder();
/** Exact UTF-8 byte length. Works identically in the browser and on the server; never uses Buffer. */
export const utf8ByteLength = (text: string): number => encoder.encode(text).length;

/**
 * Offsets are reported as line/column many times per document, so the line starts
 * are indexed once and looked up by binary search. Scanning from offset 0 for every
 * diagnostic made a dense 1 MiB document quadratic.
 */
export class PositionIndex {
  private readonly lineStarts: number[];

  constructor(private readonly text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    this.lineStarts = starts;
  }

  at(offset: number): Position {
    const clamped = offset < 0 ? 0 : offset > this.text.length ? this.text.length : offset;
    let low = 0, high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= clamped) low = mid; else high = mid - 1;
    }
    return { line: low + 1, col: clamped - this.lineStarts[low] + 1 };
  }

  range(start: number, end: number): Range {
    return { start: this.at(start), end: this.at(end) };
  }
}

/** Kept for callers that need a single position; prefer `PositionIndex` in a loop. */
export function offsetToPosition(text: string, offset: number): Position {
  return new PositionIndex(text).at(offset);
}

/** Max bracket nesting, ignoring strings. */
export function jsonDepth(text: string): number {
  let depth = 0, max = 0, inStr = false, esc = false;
  for (const ch of text) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') { depth++; if (depth > max) max = depth; } else if (ch === '}' || ch === ']') depth--;
  }
  return max;
}

const BOM = '﻿';
const rootTypeName = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * Wrappers authors paste around JSON: fenced code blocks, XML-ish tags and prose
 * preambles. They are reported as what they are instead of as a bare syntax error,
 * and they are never stripped — the source stays exactly as typed.
 */
function wrapperDetail(text: string): string | undefined {
  const trimmed = text.trim();
  if (/^`{3,}/.test(trimmed)) return 'markdown code fence';
  if (trimmed.startsWith('<')) return 'markup wrapper';
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && /[{[]/.test(trimmed)) return 'text around the JSON document';
  return undefined;
}

function parseErrorDiagnostics(text: string, ref: DocumentRef): Diagnostic[] {
  const index = new PositionIndex(text);
  const wrapper = wrapperDetail(text);
  if (wrapper) return [makeDiagnostic('E_JSON_PARSE', { ref, path: '', meta: { detail: wrapper }, range: index.range(0, 1) })];
  const errs: ParseError[] = [];
  lenientParse(text, errs, { allowTrailingComma: false, disallowComments: true });
  const errors = errs.slice(0, 5).map((e) => makeDiagnostic('E_JSON_PARSE', {
    ref,
    path: '',
    meta: { detail: printParseErrorCode(e.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() },
    range: index.range(e.offset, e.offset + Math.max(1, e.length)),
  }));
  return errors.length ? errors : [makeDiagnostic('E_JSON_PARSE', { ref, path: '', meta: { detail: 'unparseable' } })];
}

const pointerSegment = (segment: string | number): string => String(segment).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * `JSON.parse` silently keeps the last of two identical keys and turns overflowing
 * literals into Infinity. Both destroy authored meaning, so they are found on the
 * syntax tree — where the evidence still exists — and reported, never repaired.
 *
 * The walk stops as soon as the diagnostic cap is reached: the document is already
 * rejected, and continuing would let hostile input dictate how much work happens.
 */
function syntaxTreeDiagnostics(text: string, tree: Node | undefined, ref: DocumentRef): Diagnostic[] {
  if (!tree) return [];
  const index = new PositionIndex(text);
  const out: Diagnostic[] = [];
  let truncated = false;

  const add = (diagnostic: Diagnostic): boolean => {
    if (out.length >= MAX_PARSE_DIAGNOSTICS) { truncated = true; return false; }
    out.push(diagnostic);
    return true;
  };

  const visit = (node: Node, path: string): boolean => {
    if (truncated) return false;
    if (node.type === 'number' && !Number.isFinite(node.value)) {
      if (!add(makeDiagnostic('E_JSON_NUMBER_RANGE', {
        ref,
        path,
        meta: { received: text.slice(node.offset, node.offset + Math.min(node.length, 40)) },
        range: index.range(node.offset, node.offset + node.length),
      }))) return false;
    }
    if (node.type === 'object') {
      const seen = new Set<string>();
      for (const property of node.children ?? []) {
        const keyNode = property.children?.[0];
        if (!keyNode || typeof keyNode.value !== 'string') continue;
        const key: string = keyNode.value;
        if (seen.has(key)) {
          if (!add(makeDiagnostic('E_JSON_DUPLICATE_KEY', {
            ref,
            path: `${path}/${pointerSegment(key)}`,
            meta: { key: key.slice(0, 60) },
            range: index.range(keyNode.offset, keyNode.offset + keyNode.length),
          }))) return false;
        }
        seen.add(key);
        const valueNode = property.children?.[1];
        if (valueNode && !visit(valueNode, `${path}/${pointerSegment(key)}`)) return false;
      }
      return true;
    }
    if (node.type === 'array') {
      const children = node.children ?? [];
      for (let i = 0; i < children.length; i++) if (!visit(children[i], `${path}/${i}`)) return false;
    }
    return true;
  };

  visit(tree, '');
  if (truncated && out.length) {
    out[out.length - 1] = { ...out[out.length - 1], meta: { ...out[out.length - 1].meta, truncated: MAX_PARSE_DIAGNOSTICS } };
  }
  return out;
}

/**
 * The single strict entry point for turning authored text into a document value.
 * Nothing here repairs input: any deviation produces diagnostics and `value`
 * stays `undefined`, so no caller can accidentally persist a coerced document.
 */
export function parseJsonDocument(text: string, doc: string | DocumentRef, opts: ParseOptions = {}): ParsedDocument {
  const ref = toRef(doc);
  const base = { ref, docId: refLabel(ref), text };
  if (text.startsWith(BOM)) {
    return { ...base, value: undefined, errors: [makeDiagnostic('E_JSON_PARSE', { ref, path: '', meta: { detail: 'byte order mark' }, range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } } })] };
  }
  const maxBytes = opts.maxBytes ?? MAX_DOCUMENT_BYTES;
  const bytes = utf8ByteLength(text);
  if (bytes > maxBytes) return { ...base, value: undefined, errors: [makeDiagnostic('E_LIMIT_EXCEEDED', { ref, path: '', meta: { limit: 'bytes', received: bytes, expected: maxBytes } })] };
  const depth = jsonDepth(text);
  if (depth > MAX_JSON_DEPTH) return { ...base, value: undefined, errors: [makeDiagnostic('E_LIMIT_EXCEEDED', { ref, path: '', meta: { limit: 'depth', received: depth, expected: MAX_JSON_DEPTH } })] };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ...base, value: undefined, errors: parseErrorDiagnostics(text, ref) };
  }

  if ((opts.rootType ?? 'object') === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    return { ...base, value: undefined, errors: [makeDiagnostic('E_JSON_ROOT_NOT_OBJECT', { ref, path: '', meta: { received: rootTypeName(value) } })] };
  }

  const tree = parseTree(text);
  const errors = syntaxTreeDiagnostics(text, tree, ref);
  return { ...base, value: errors.length ? undefined : value, tree, errors };
}

/** Exact pointer tokens: `~1` and `~0` are decoded, and nothing else is reinterpreted. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return pointer === '' ? [] : [''];
  return pointer.slice(1).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** A canonical array index: no leading zeros, no signs, no whitespace. */
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

/**
 * Resolves a JSON Pointer against the syntax tree, deciding what each token means
 * from the node it is applied to rather than from how it looks.
 *
 * Guessing by appearance broke real content: an answer key keyed `"01"` and `"1"` are
 * distinct object properties, and coercing either token to a number found neither, so
 * a diagnostic about them lost its source range and stopped being clickable. Object
 * keys are matched as exact strings; only an array consumes a numeric token.
 */
export function findNodeAtPointer(root: Node, pointer: string): Node | undefined {
  let node: Node | undefined = root;
  for (const token of pointerTokens(pointer)) {
    if (!node) return undefined;
    if (node.type === 'object') {
      const property: Node | undefined = (node.children ?? []).find((child) => child.children?.[0]?.value === token);
      node = property?.children?.[1];
      continue;
    }
    if (node.type === 'array') {
      if (!ARRAY_INDEX.test(token)) return undefined;
      node = (node.children ?? [])[Number(token)];
      continue;
    }
    return undefined;
  }
  return node;
}

export function pointerToRange(parsed: ParsedDocument, pointer: string): Range | undefined {
  if (!parsed.tree) return undefined;
  const node = findNodeAtPointer(parsed.tree, pointer);
  if (!node) return undefined;
  return new PositionIndex(parsed.text).range(node.offset, node.offset + node.length);
}

/**
 * Strict parse for a multi-document envelope: a `{ manifest, items }` workspace
 * backup or a recovery record. Identical rules to `parseJsonDocument`, only with the
 * envelope byte budget — so a legitimate saved backup larger than one document can
 * be reimported without loosening anything.
 */
export function parseJsonEnvelope(text: string, doc: string | DocumentRef, opts: Omit<ParseOptions, 'maxBytes'> = {}): ParsedDocument {
  return parseJsonDocument(text, doc, { ...opts, maxBytes: MAX_ENVELOPE_BYTES });
}

/**
 * Per-document byte limits inside a multi-document envelope.
 *
 * The envelope gets the larger budget, but that is a transport allowance, not a
 * licence for one document to grow past its own limit. A 2 MiB workspace backup made
 * of small documents reimports; a backup containing one 2 MiB lesson does not.
 */
export function documentSizeDiagnostics(manifest: unknown, items: Record<string, unknown>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const check = (ref: DocumentRef, value: unknown) => {
    if (value === undefined) return;
    const bytes = utf8ByteLength(JSON.stringify(value) ?? '');
    if (bytes > MAX_DOCUMENT_BYTES) {
      out.push(makeDiagnostic('E_LIMIT_EXCEEDED', { ref, path: '', meta: { limit: 'bytes', received: bytes, expected: MAX_DOCUMENT_BYTES } }));
    }
  };
  check(COURSE_REF, manifest);
  for (const [id, item] of Object.entries(items)) check(itemRef(id), item);
  return out;
}

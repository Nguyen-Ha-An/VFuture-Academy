/**
 * Import and export codecs for Studio content transfer.
 *
 * Pure, synchronous and browser-safe: no `Buffer`, no `fetch`, no DOM, no clock. The
 * UI owns dialogs, file pickers and downloads; this module owns the bytes-to-snapshot
 * contract and nothing else.
 *
 * Two rules run through all of it. Nothing is repaired — no wrapper stripping, no id
 * renaming, no invented documents, no coerced types — and every failure comes back as
 * `Diagnostic[]` rather than an exception, so the caller can render it in either
 * locale next to the offending line.
 */
import { ID_PATTERN } from '@/content-engine/schema/common';
import type { CourseDocument } from '@/content-engine/schema/course';
import { COURSE_REF, itemRef, makeDiagnostic, refKey, refLabel, refOf, type Diagnostic, type DocumentRef } from '@/content-engine/diagnostics';
import { assessWorkspace } from '@/content-engine/validate/assess';
import { MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES, parseJsonDocument, parseJsonEnvelope, utf8ByteLength } from '@/content-engine/validate/parse';
import { validateDocument } from '@/content-engine/validate/structural';
import { inlineWorkspace, ITEM_KINDS, splitInlineCourse } from '@/content-engine/validate/workspace';
import { RECOVERY_EXPORT_KIND, RECOVERY_EXPORT_VERSION } from './recovery/types';

export { MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES };

/**
 * A transfer file is an envelope that may legitimately carry several documents, so it
 * gets the engine's wire ceiling rather than the single-document one. Every document
 * lifted out of it is still measured against `MAX_DOCUMENT_BYTES`, so the looser
 * envelope limit never widens what one document may be.
 */
export const MAX_TRANSFER_BYTES = MAX_ENVELOPE_BYTES;

export const WORKSPACE_ENVELOPE_KIND = 'vfuture.studio.workspace';
export const WORKSPACE_ENVELOPE_VERSION = 1;
export const SUPPORTED_WORKSPACE_ENVELOPE_VERSIONS = [WORKSPACE_ENVELOPE_VERSION] as const;
export const SUPPORTED_RECOVERY_EXPORT_VERSIONS = [RECOVERY_EXPORT_VERSION] as const;

/** Placeholder identity for a standalone item whose own `id` has not been read yet. */
const PENDING_ITEM_REF: DocumentRef = itemRef('imported-item');

export type ItemKind = (typeof ITEM_KINDS)[number];
export type ImportSnapshot = { manifest: unknown; items: Record<string, unknown>; baseVersionId?: string | null };
export type ImportedItem = { id: string; kind: ItemKind; document: unknown };
export type RawSourceRecovery = {
  courseId: string;
  /** Raw editor text keyed by `refKey`. Returned byte-for-byte, however invalid. */
  sources: Record<string, string>;
  baseVersionId: string | null;
  baseUpdatedAt: string | null;
  modifiedAt: string | null;
};

export type DecodeResult<T> = { ok: true; value: T; warnings: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

export type WorkspaceEnvelope = {
  kind: typeof WORKSPACE_ENVELOPE_KIND;
  version: number;
  courseId: string | null;
  manifest: unknown;
  items: Record<string, unknown>;
  /** Omitted entirely when the snapshot has no base version, so the round trip is exact. */
  baseVersionId?: string | null;
};

export type RawSourceEnvelope = {
  kind: typeof RECOVERY_EXPORT_KIND;
  version: number;
  courseId: string;
  sources: Record<string, string>;
  baseVersionId: string | null;
  baseUpdatedAt: string | null;
  modifiedAt: string | null;
};

export type Normalization = {
  ref: DocumentRef;
  path: string;
  kind: 'inlined-item' | 'dropped-item-envelope' | 'dropped-item-language';
  detail: string;
  message: { vi: string; en: string };
};

export type DecodedImport =
  | { form: 'course'; snapshot: ImportSnapshot }
  | { form: 'workspace'; snapshot: ImportSnapshot }
  | { form: 'item'; item: ImportedItem }
  | { form: 'recovery'; recovery: RawSourceRecovery };

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

const fail = (...diagnostics: Diagnostic[]): DecodeResult<never> => ({ ok: false, diagnostics });
const done = <T>(value: T, warnings: Diagnostic[] = []): DecodeResult<T> => ({ ok: true, value, warnings });

const schemaError = (ref: DocumentRef, path: string, detail: string): Diagnostic =>
  makeDiagnostic('E_SCHEMA', { ref, path, meta: { detail } });

/** Own-property object test on untrusted JSON. Arrays and `null` are not objects here. */
const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Copies own enumerable keys onto a null-prototype record, so `__proto__` stays data. */
function ownRecord(source: Record<string, unknown>): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}

const typeName = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/** `string | null` with no coercion: a number, an object or a missing key is an error, never `null`. */
function nullableString(row: Record<string, unknown>, key: string, ref: DocumentRef, required: boolean): { ok: true; value: string | null } | { ok: false; diagnostic: Diagnostic } {
  if (!Object.hasOwn(row, key) || row[key] === undefined) {
    return required
      ? { ok: false, diagnostic: schemaError(ref, `/${key}`, `"${key}" is required`) }
      : { ok: true, value: null };
  }
  const value = row[key];
  if (value === null || typeof value === 'string') return { ok: true, value };
  return { ok: false, diagnostic: schemaError(ref, `/${key}`, `"${key}" must be a string or null, received ${typeName(value)}`) };
}

/**
 * Canonical UUID shape, case-insensitive. Server-side `baseVersionId` is
 * `z.string().uuid()`; this check is deliberately no *stricter* than that, so a
 * legitimate version id is never refused locally by a codec that guessed at the
 * variant bits. Anything that is not a UUID at all is refused here rather than sent
 * to a write that would reject it.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The complete set of keys a workspace transfer may carry, kinded or bare. */
const WORKSPACE_ENVELOPE_KEYS = ['kind', 'version', 'courseId', 'manifest', 'items', 'baseVersionId'] as const;

function rejectUnknownKeys(row: Record<string, unknown>, allowed: readonly string[], ref: DocumentRef): Diagnostic[] {
  return Object.keys(row)
    .filter((key) => !allowed.includes(key))
    .map((key) => schemaError(ref, `/${key}`, `unknown field "${key}"`));
}

/** One authored document: the engine's 1 MiB cap. */
const parseDocumentText = (text: string, ref: DocumentRef) => parseJsonDocument(text, ref, { rootType: 'object' });

/**
 * A transfer file: the engine's envelope cap, so a large but legitimate saved backup
 * can be read back in. Each document inside is re-measured against the document cap.
 */
const parseEnvelopeText = (text: string, ref: DocumentRef) => parseJsonEnvelope(text, ref, { rootType: 'object' });

/**
 * A document inside an envelope has no authored text of its own, so its size is
 * measured on the canonical serialization of the value that was actually carried.
 */
function documentTooLarge(value: unknown, ref: DocumentRef): Diagnostic | null {
  const bytes = utf8ByteLength(JSON.stringify(value) ?? '');
  return bytes > MAX_DOCUMENT_BYTES
    ? makeDiagnostic('E_LIMIT_EXCEEDED', { ref, path: '', meta: { limit: 'bytes', received: bytes, expected: MAX_DOCUMENT_BYTES } })
    : null;
}

/** Re-points diagnostics raised before a document's identity was known. */
const retarget = (diagnostics: readonly Diagnostic[], ref: DocumentRef): Diagnostic[] =>
  diagnostics.map((d) => (refKey(refOf(d)) === refKey(PENDING_ITEM_REF) ? { ...d, ref, docId: refLabel(ref) } : d));

const isItemKind = (value: unknown): value is ItemKind => typeof value === 'string' && (ITEM_KINDS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// decoders
// ---------------------------------------------------------------------------

/**
 * The existing single-file course format: one `kind: "course"` document whose items
 * are written inline. Items declared as bare stubs with no body fail here — an
 * imported course that references documents it does not carry is incomplete, and
 * hydrating the gap with an empty document would invent content nobody wrote.
 */
export function decodeCourseImport(text: string, courseId?: string): DecodeResult<ImportSnapshot> {
  const parsed = parseDocumentText(text, COURSE_REF);
  if (parsed.errors.length) return fail(...parsed.errors);

  const assessment = assessWorkspace({ manifest: parsed.value, items: {} }, { courseId, requireComplete: true });
  if (!assessment.ok) return fail(...assessment.errors);

  // Validated above, so the split restructures modules on the *raw* value: no zod
  // defaults are folded in and the author's bytes survive the import.
  const snapshot = splitInlineCourse(parsed.value as CourseDocument);
  return done({ manifest: snapshot.manifest, items: ownRecord(snapshot.items as Record<string, unknown>) }, assessment.warnings);
}

/** One standalone lesson, exam or assignment document. */
export function decodeItemImport(text: string): DecodeResult<ImportedItem> {
  const parsed = parseDocumentText(text, PENDING_ITEM_REF);
  if (parsed.errors.length) return fail(...parsed.errors);

  const row = asObject(parsed.value);
  const id = row?.id;
  const ref = typeof id === 'string' && ID_PATTERN.test(id) ? itemRef(id) : PENDING_ITEM_REF;

  const result = validateDocument(parsed.value, ref);
  if (!result.ok) return fail(...retarget(result.diagnostics, ref));
  if (!isItemKind(result.kind)) {
    return fail(makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref, path: '/kind', meta: { id: typeof id === 'string' ? id : '', expected: ITEM_KINDS.join(' | '), received: result.kind } }));
  }
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return fail(makeDiagnostic('E_ID_FORMAT', { ref, path: '/id' }));

  return done({ id, kind: result.kind, document: parsed.value });
}

/**
 * The lossless workspace backup: the manifest and every item document exactly as
 * stored, so `$schema`, `languages` and `defaultLanguage` on standalone items — all of
 * which the portable inline course export has to drop — come back unchanged.
 *
 * Both the kinded envelope written by `encodeWorkspaceEnvelope` and a plain
 * `{ manifest, items }` object are accepted.
 */
export function decodeWorkspaceEnvelope(text: string, courseId?: string): DecodeResult<ImportSnapshot> {
  const parsed = parseEnvelopeText(text, COURSE_REF);
  if (parsed.errors.length) return fail(...parsed.errors);
  const root = asObject(parsed.value);
  if (!root) return fail(makeDiagnostic('E_JSON_ROOT_NOT_OBJECT', { ref: COURSE_REF, path: '', meta: { received: typeName(parsed.value) } }));

  const kind = root.kind;

  if (kind !== undefined && kind !== WORKSPACE_ENVELOPE_KIND) {
    return fail(makeDiagnostic('E_UNKNOWN_KIND', { ref: COURSE_REF, path: '/kind', meta: { received: String(kind), valid: WORKSPACE_ENVELOPE_KIND } }));
  }
  if (kind === WORKSPACE_ENVELOPE_KIND) {
    const version = root.version;
    if (typeof version !== 'number' || !(SUPPORTED_WORKSPACE_ENVELOPE_VERSIONS as readonly number[]).includes(version)) {
      return fail(makeDiagnostic('E_SCHEMA_VERSION_UNSUPPORTED', { ref: COURSE_REF, path: '/version', meta: { received: String(version ?? 'missing'), expected: SUPPORTED_WORKSPACE_ENVELOPE_VERSIONS.join(', ') } }));
    }
  } else if (Object.hasOwn(root, 'version')) {
    return fail(schemaError(COURSE_REF, '/version', 'a versioned envelope must also declare its "kind"'));
  }

  // Both shapes are equally strict. A bare `{ manifest, items }` download that has
  // picked up an extra field is an unknown format, not a workspace with a bonus.
  const unknown = rejectUnknownKeys(root, WORKSPACE_ENVELOPE_KEYS, COURSE_REF);
  if (unknown.length) return fail(...unknown);

  /**
   * Absent is not the same as null. `undefined` means "this transfer says nothing
   * about the base version"; `null` means "based on no version at all". Collapsing
   * the first into the second would tell a save it may start from scratch.
   */
  let baseVersionId: string | null | undefined;
  if (Object.hasOwn(root, 'baseVersionId') && root.baseVersionId !== undefined) {
    const base = nullableString(root, 'baseVersionId', COURSE_REF, false);
    if (!base.ok) return fail(base.diagnostic);
    if (base.value !== null && !UUID_PATTERN.test(base.value)) {
      return fail(schemaError(COURSE_REF, '/baseVersionId', '"baseVersionId" must be a version uuid'));
    }
    baseVersionId = base.value;
  }

  if (!Object.hasOwn(root, 'manifest')) return fail(schemaError(COURSE_REF, '/manifest', '"manifest" is required'));
  if (!Object.hasOwn(root, 'items')) return fail(schemaError(COURSE_REF, '/items', '"items" is required'));
  const items = asObject(root.items);
  if (!items) return fail(schemaError(COURSE_REF, '/items', `"items" must be an object keyed by item id, received ${typeName(root.items)}`));

  const sizes: Diagnostic[] = [];
  const manifestSize = documentTooLarge(root.manifest, COURSE_REF);
  if (manifestSize) sizes.push(manifestSize);

  const documents = Object.create(null) as Record<string, unknown>;
  for (const id of Object.keys(items)) {
    if (!Object.hasOwn(items, id)) continue;
    const ref = itemRef(id);
    if (!ID_PATTERN.test(id)) { sizes.push(makeDiagnostic('E_ID_FORMAT', { ref, path: `/items/${id}` })); continue; }
    const oversize = documentTooLarge(items[id], ref);
    if (oversize) sizes.push(oversize);
    documents[id] = items[id];
  }
  if (sizes.length) return fail(...sizes);

  // The envelope's own `courseId` is a claim about the manifest it carries. If the two
  // disagree the file has been edited or assembled by hand, and neither one may be
  // quietly preferred over the other.
  if (Object.hasOwn(root, 'courseId') && root.courseId !== undefined && root.courseId !== null) {
    const declared = root.courseId;
    if (typeof declared !== 'string') return fail(schemaError(COURSE_REF, '/courseId', `"courseId" must be a string or null, received ${typeName(declared)}`));
    const manifestId = asObject(root.manifest)?.id;
    if (manifestId !== declared) {
      return fail(makeDiagnostic('E_WORKSPACE_ID_MISMATCH', { ref: COURSE_REF, path: '/courseId', meta: { received: declared, expected: typeof manifestId === 'string' ? manifestId : 'missing' } }));
    }
  }

  const assessment = assessWorkspace({ manifest: root.manifest, items: documents }, { courseId, requireComplete: true });
  if (!assessment.ok) return fail(...assessment.errors);

  return done({ manifest: root.manifest, items: documents, ...(baseVersionId === undefined ? {} : { baseVersionId }) }, assessment.warnings);
}

/**
 * Explicit raw-source recovery import.
 *
 * This one is deliberately unforgiving about its envelope and deliberately permissive
 * about its payload. The envelope must say what it is (`kind` and a supported
 * `version`) because the older bare `{ courseId, sources, baseVersionId }` download
 * used ambiguous keys: `manifest` there could mean the course document or an item
 * legitimately named `manifest`, and guessing would let one silently overwrite the
 * other. The source *text*, by contrast, is returned byte-for-byte however broken it
 * is — unfinished, invalid text is the entire reason recovery exists.
 */
export function decodeRawSourceRecovery(text: string): DecodeResult<RawSourceRecovery> {
  const parsed = parseEnvelopeText(text, COURSE_REF);
  if (parsed.errors.length) return fail(...parsed.errors);
  const root = asObject(parsed.value);
  if (!root) return fail(makeDiagnostic('E_JSON_ROOT_NOT_OBJECT', { ref: COURSE_REF, path: '', meta: { received: typeName(parsed.value) } }));

  if (root.kind !== RECOVERY_EXPORT_KIND) {
    return fail(makeDiagnostic('E_UNKNOWN_KIND', { ref: COURSE_REF, path: '/kind', meta: { received: String(root.kind ?? 'missing'), valid: RECOVERY_EXPORT_KIND } }));
  }
  const version = root.version;
  if (typeof version !== 'number' || !(SUPPORTED_RECOVERY_EXPORT_VERSIONS as readonly number[]).includes(version)) {
    return fail(makeDiagnostic('E_SCHEMA_VERSION_UNSUPPORTED', { ref: COURSE_REF, path: '/version', meta: { received: String(version ?? 'missing'), expected: SUPPORTED_RECOVERY_EXPORT_VERSIONS.join(', ') } }));
  }
  const unknown = rejectUnknownKeys(root, ['kind', 'version', 'courseId', 'sources', 'baseVersionId', 'baseUpdatedAt', 'modifiedAt', 'savedAt'], COURSE_REF);
  if (unknown.length) return fail(...unknown);

  const courseId = root.courseId;
  if (typeof courseId !== 'string' || !ID_PATTERN.test(courseId)) {
    return fail(makeDiagnostic('E_ID_FORMAT', { ref: COURSE_REF, path: '/courseId' }));
  }

  const sourcesRow = asObject(root.sources);
  if (!sourcesRow) return fail(schemaError(COURSE_REF, '/sources', `"sources" must be an object keyed by document reference, received ${typeName(root.sources)}`));

  const problems: Diagnostic[] = [];
  const sources = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(sourcesRow)) {
    if (!Object.hasOwn(sourcesRow, key)) continue;
    const ref = sourceKeyRef(key);
    if (!ref) { problems.push(schemaError(COURSE_REF, `/sources/${key}`, `source key must be "course" or "item:<id>", received "${key}"`)); continue; }
    const value = sourcesRow[key];
    if (typeof value !== 'string') { problems.push(schemaError(ref, `/sources/${key}`, `raw source must be a string, received ${typeName(value)}`)); continue; }
    // Deliberately no per-source document cap. Recovery text is unfinished by
    // definition, and a source that has grown past the 1 MiB document limit is
    // exactly the work an author must not lose: it stays restorable locally and is
    // told E_LIMIT_EXCEEDED when it is assessed for a save. The envelope's own 2 MiB
    // ceiling still bounds the file, and this text never reaches the server unvalidated.
    sources[key] = value;
  }
  if (!Object.hasOwn(sources, refKey(COURSE_REF)) && !problems.some((d) => d.path === `/sources/${refKey(COURSE_REF)}`)) {
    problems.push(schemaError(COURSE_REF, '/sources', `"sources" must include the course document under "${refKey(COURSE_REF)}"`));
  }
  if (problems.length) return fail(...problems);

  const baseVersionId = nullableString(root, 'baseVersionId', COURSE_REF, false);
  if (!baseVersionId.ok) return fail(baseVersionId.diagnostic);
  const baseUpdatedAt = nullableString(root, 'baseUpdatedAt', COURSE_REF, false);
  if (!baseUpdatedAt.ok) return fail(baseUpdatedAt.diagnostic);
  const modifiedAt = nullableString(root, Object.hasOwn(root, 'modifiedAt') ? 'modifiedAt' : 'savedAt', COURSE_REF, false);
  if (!modifiedAt.ok) return fail(modifiedAt.diagnostic);

  return done({ courseId, sources, baseVersionId: baseVersionId.value, baseUpdatedAt: baseUpdatedAt.value, modifiedAt: modifiedAt.value });
}

/** `course` or `item:<valid-id>`, and nothing else. */
function sourceKeyRef(key: string): DocumentRef | null {
  if (key === refKey(COURSE_REF)) return COURSE_REF;
  if (!key.startsWith('item:')) return null;
  const id = key.slice('item:'.length);
  return ID_PATTERN.test(id) ? itemRef(id) : null;
}

/**
 * Reads whichever of the four forms the text actually is, so one paste box can accept
 * all of them. The form is decided by the document's own declared `kind`, never by
 * trying each decoder until one stops complaining — that would report the last
 * decoder's confusion instead of the real error.
 */
export function decodeAnyImport(text: string, courseId?: string): DecodeResult<DecodedImport> {
  const parsed = parseEnvelopeText(text, COURSE_REF);
  if (parsed.errors.length) return fail(...parsed.errors);
  const root = asObject(parsed.value);
  if (!root) return fail(makeDiagnostic('E_JSON_ROOT_NOT_OBJECT', { ref: COURSE_REF, path: '', meta: { received: typeName(parsed.value) } }));

  const kind = root.kind;
  if (kind === RECOVERY_EXPORT_KIND) return map(decodeRawSourceRecovery(text), (recovery) => ({ form: 'recovery' as const, recovery }));
  if (kind === WORKSPACE_ENVELOPE_KIND) return map(decodeWorkspaceEnvelope(text, courseId), (snapshot) => ({ form: 'workspace' as const, snapshot }));
  if (kind === 'course') return map(decodeCourseImport(text, courseId), (snapshot) => ({ form: 'course' as const, snapshot }));
  if (isItemKind(kind)) return map(decodeItemImport(text), (item) => ({ form: 'item' as const, item }));
  if (Object.hasOwn(root, 'manifest') && Object.hasOwn(root, 'items')) {
    return map(decodeWorkspaceEnvelope(text, courseId), (snapshot) => ({ form: 'workspace' as const, snapshot }));
  }
  return fail(makeDiagnostic('E_UNKNOWN_KIND', { ref: COURSE_REF, path: '/kind', meta: { received: String(kind ?? 'missing'), valid: ['course', ...ITEM_KINDS, WORKSPACE_ENVELOPE_KIND, RECOVERY_EXPORT_KIND].join(', ') } }));
}

const map = <A, B>(result: DecodeResult<A>, f: (value: A) => B): DecodeResult<B> =>
  result.ok ? { ok: true, value: f(result.value), warnings: result.warnings } : result;

// ---------------------------------------------------------------------------
// encoders
// ---------------------------------------------------------------------------

/** Lossless backup value. The caller serializes and downloads it. */
export function encodeWorkspaceEnvelope(snapshot: ImportSnapshot): WorkspaceEnvelope {
  const manifestId = asObject(snapshot.manifest)?.id;
  return {
    kind: WORKSPACE_ENVELOPE_KIND,
    version: WORKSPACE_ENVELOPE_VERSION,
    courseId: typeof manifestId === 'string' ? manifestId : null,
    manifest: snapshot.manifest,
    items: ownRecord(snapshot.items),
    ...(snapshot.baseVersionId === undefined ? {} : { baseVersionId: snapshot.baseVersionId }),
  };
}

/** Versioned raw-source download, matching `recovery/types.ts`. */
export function encodeRawSourceRecovery(
  courseId: string,
  sources: Record<string, string>,
  baseVersionId: string | null,
  meta: { baseUpdatedAt?: string | null; modifiedAt?: string | null } = {},
): RawSourceEnvelope {
  return {
    kind: RECOVERY_EXPORT_KIND,
    version: RECOVERY_EXPORT_VERSION,
    courseId,
    sources: ownRecord(sources) as Record<string, string>,
    baseVersionId,
    baseUpdatedAt: meta.baseUpdatedAt ?? null,
    modifiedAt: meta.modifiedAt ?? null,
  };
}

const normalization = (ref: DocumentRef, path: string, kind: Normalization['kind'], detail: string, vi: string, en: string): Normalization =>
  ({ ref, path, kind, detail, message: { vi, en } });

/**
 * Portable single-file course: every item folded back into its manifest entry.
 *
 * Inlining is lossy by construction — a nested item has no envelope of its own, so
 * `$schema`, `languages` and `defaultLanguage` cannot travel with it. Rather than drop
 * them quietly, every loss is returned so the UI can show it before the download and
 * point the author at the workspace backup when they wanted an exact copy.
 */
export function encodeCourseExport(snapshot: ImportSnapshot): { ok: true; document: unknown; normalizations: Normalization[] } | { ok: false; diagnostics: Diagnostic[] } {
  const assessment = assessWorkspace({ manifest: snapshot.manifest, items: snapshot.items }, { requireComplete: true });
  if (!assessment.ok || !assessment.parsed) return { ok: false, diagnostics: assessment.errors };

  const normalizations: Normalization[] = [];
  for (const id of Object.keys(assessment.parsed.items).sort()) {
    const ref = itemRef(id);
    const source = asObject(snapshot.items[id]);
    if (!source) continue; // inline in the manifest already; nothing was lifted out
    normalizations.push(normalization(ref, '', 'inlined-item', id,
      `Bài "${id}" được nhúng thẳng vào manifest.`, `Item "${id}" is inlined into the manifest.`));
    if (source.$schema !== undefined) {
      normalizations.push(normalization(ref, '/$schema', 'dropped-item-envelope', '$schema',
        `Bài "${id}" mất trường "$schema" khi nhúng.`, `Item "${id}" loses "$schema" when inlined.`));
    }
    for (const field of ['languages', 'defaultLanguage'] as const) {
      if (source[field] !== undefined) {
        normalizations.push(normalization(ref, `/${field}`, 'dropped-item-language', field,
          `Bài "${id}" mất trường "${field}" khi nhúng; khóa học quyết định ngôn ngữ.`,
          `Item "${id}" loses "${field}" when inlined; the course decides the languages.`));
      }
    }
  }

  return { ok: true, document: inlineWorkspace(assessment.parsed), normalizations };
}

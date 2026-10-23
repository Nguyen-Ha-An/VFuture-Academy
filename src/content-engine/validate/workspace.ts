import type { CourseDocument, ManifestItem } from '../schema/course';
import { isInlineItem } from '../schema/course';
import type { LessonDocument } from '../schema/lesson';
import type { ExamDocument } from '../schema/exam';
import type { AssignmentDocument } from '../schema/bundle';
import { CURRENT_SCHEMA_VERSION } from '../schema/common';
import { detectKind } from '../schema/document';
import { COURSE_REF, itemRef, makeDiagnostic, refKey, refLabel, type Diagnostic, type DocumentRef } from '../diagnostics';
import { validateDocument } from './structural';

export type ItemDocument = LessonDocument | ExamDocument | AssignmentDocument;
export const ITEM_KINDS = ['lesson', 'exam', 'assignment'] as const;

export interface SourceMap { sourceId: string; basePath: string }

export interface CourseWorkspace {
  manifest: unknown;
  items: Record<string, unknown>;
  /**
   * Raw authored text, keyed by `refKey` (`course`, `item:<id>`). Legacy `docId`
   * keys (`manifest`, `<id>`) are still read for compatibility, but new producers
   * write `refKey` so an item legitimately named `manifest` keeps its own source
   * instead of overwriting the course document's.
   */
  sources?: Record<string, string>;
  sourceMaps?: Record<string, SourceMap>;
  parseDiagnostics?: Diagnostic[];
}

/** `invalidItemIds`: ids in `ws.items` whose document failed structural validation — their errors are already reported. */
export interface ParsedWorkspace { manifest: CourseDocument; items: Record<string, ItemDocument>; invalidItemIds: string[] }

/** Legacy label for the course document. Prefer `COURSE_REF`. */
export const MANIFEST_DOC_ID = 'manifest';

/** Collision-free storage key for one document's raw source. */
export const sourceKeyOf = (ref: DocumentRef): string => refKey(ref);

const pick = <T,>(record: Record<string, T> | undefined, ref: DocumentRef): T | undefined => {
  if (!record) return undefined;
  const key = sourceKeyOf(ref);
  if (Object.hasOwn(record, key)) return record[key];
  const legacy = refLabel(ref);
  return Object.hasOwn(record, legacy) ? record[legacy] : undefined;
};

export const workspaceSource = (ws: CourseWorkspace, ref: DocumentRef): string | undefined => pick(ws.sources, ref);
export const workspaceSourceMap = (ws: CourseWorkspace, ref: DocumentRef): SourceMap | undefined => pick(ws.sourceMaps, ref);

/** Own-property lookup on an untrusted, JSON-derived record. */
export const ownEntry = <T,>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

export function parseWorkspace(ws: CourseWorkspace): { ok: boolean; parsed?: ParsedWorkspace; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const m = validateDocument(ws.manifest, COURSE_REF);
  if (!m.ok) return { ok: false, diagnostics: m.diagnostics };
  if (m.kind !== 'course') return { ok: false, diagnostics: [makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref: COURSE_REF, path: '/kind', meta: { id: MANIFEST_DOC_ID, expected: 'course', received: m.kind } })] };
  const split = splitInlineCourse(m.doc); // inline manifest items become documents; the manifest keeps stubs
  const items = Object.assign(Object.create(null) as Record<string, ItemDocument>, split.items);
  const inlineIds = new Set(Object.keys(split.items));
  const invalidItemIds: string[] = [];
  for (const [itemId, raw] of Object.entries(ws.items)) {
    const ref = itemRef(itemId);
    // An item cannot have its body inline in the manifest *and* a separate document:
    // one of the two is about to be discarded, and which one is not the parser's call.
    if (inlineIds.has(itemId)) {
      diagnostics.push(makeDiagnostic('E_DUPLICATE_ITEM_DOCUMENT', { ref, path: '', meta: { id: itemId } }));
      invalidItemIds.push(itemId);
      continue;
    }
    const r = validateDocument(raw, ref);
    if (!r.ok) { diagnostics.push(...r.diagnostics); invalidItemIds.push(itemId); continue; }
    if (!(ITEM_KINDS as readonly string[]).includes(r.kind)) { diagnostics.push(makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref, path: '/kind', meta: { id: itemId, expected: ITEM_KINDS.join(' | '), received: r.kind } })); invalidItemIds.push(itemId); continue; }
    items[itemId] = r.doc as ItemDocument;
  }
  return { ok: diagnostics.length === 0, parsed: { manifest: split.manifest, items, invalidItemIds }, diagnostics };
}

export function stubOf(item: ManifestItem): ManifestItem {
  const { type, id, title, summary, estimatedMinutes, required } = item as ManifestItem & { title?: unknown; summary?: unknown; estimatedMinutes?: unknown; required?: unknown };
  return { type, id, ...(title !== undefined ? { title } : {}), ...(summary !== undefined ? { summary } : {}), ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}), ...(required !== undefined ? { required } : {}) } as ManifestItem;
}

/** Turn inline items into separate documents; the manifest keeps stubs. Storage is always per item. */
export function splitInlineCourse(course: CourseDocument): { manifest: CourseDocument; items: Record<string, ItemDocument> } {
  const items = Object.create(null) as Record<string, ItemDocument>;
  const modules = course.modules.map((mod) => ({
    ...mod,
    items: mod.items.map((item) => {
      if (!isInlineItem(item)) return item;
      const { type, required: _r, ...body } = item as ManifestItem & Record<string, unknown>;
      items[item.id] = { schemaVersion: CURRENT_SCHEMA_VERSION, kind: type, ...body } as ItemDocument;
      return stubOf(item);
    }),
  }));
  return { manifest: { ...course, modules }, items };
}

/** Inverse of splitInlineCourse: produce a single-file course for export. */
export function inlineWorkspace(parsed: ParsedWorkspace): CourseDocument {
  const modules = parsed.manifest.modules.map((mod) => ({
    ...mod,
    items: mod.items.map((item) => {
      const doc = ownEntry(parsed.items, item.id);
      if (!doc || isInlineItem(item)) return item;
      const { schemaVersion: _v, kind, $schema: _s, languages: _l, defaultLanguage: _d, ...body } = doc as ItemDocument & { $schema?: string; languages?: unknown; defaultLanguage?: unknown };
      return { type: kind, ...body, ...(item.required !== undefined ? { required: item.required } : {}) } as ManifestItem;
    }),
  }));
  return { ...parsed.manifest, modules };
}

/**
 * Classify raw documents: the course becomes the manifest, lesson/exam/assignment
 * become items keyed by id.
 *
 * Duplicates are classified here, before the id map is written, because
 * `items[id] = doc` would otherwise silently drop the earlier document and the
 * evidence of the collision along with it.
 */
export function workspaceFromDocuments(docs: unknown[]): CourseWorkspace & { duplicates: Diagnostic[] } {
  let manifest: unknown = undefined;
  const items = Object.create(null) as Record<string, unknown>;
  const duplicates: Diagnostic[] = [];
  docs.forEach((d, index) => {
    const kind = detectKind(d);
    const id = (d as { id?: string })?.id;
    const label = typeof id === 'string' && id ? id : `document-${index + 1}`;
    if (kind === 'course') {
      if (manifest !== undefined) duplicates.push(makeDiagnostic('E_DUPLICATE_ITEM_DOCUMENT', { ref: COURSE_REF, path: '', meta: { id: label } }));
      else manifest = d;
      return;
    }
    // Anything that is neither the course nor a course item used to be dropped without
    // a word — a question bundle or a typo'd kind simply vanished from the import.
    if (!kind) {
      duplicates.push(makeDiagnostic('E_UNKNOWN_KIND', { ref: itemRef(label), path: '/kind', meta: { received: describeKind(d), valid: `course, ${ITEM_KINDS.join(', ')}` } }));
      return;
    }
    if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
      duplicates.push(makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref: itemRef(label), path: '/kind', meta: { id: label, expected: ITEM_KINDS.join(' | '), received: kind } }));
      return;
    }
    if (!id) {
      duplicates.push(makeDiagnostic('E_ID_FORMAT', { ref: itemRef(label), path: '/id' }));
      return;
    }
    if (Object.hasOwn(items, id)) {
      duplicates.push(makeDiagnostic('E_DUPLICATE_ITEM_DOCUMENT', { ref: itemRef(id), path: '/id', meta: { id } }));
      return;
    }
    items[id] = d;
  });
  return { manifest, items, duplicates };
}

const describeKind = (raw: unknown): string =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? String((raw as { kind?: unknown }).kind ?? 'missing')
    : Array.isArray(raw) ? 'array' : typeof raw;

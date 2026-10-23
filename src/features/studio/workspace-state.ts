import { stableStringify } from '@/content-engine/compile/checksum';
import {
  COURSE_REF, itemRef, makeDiagnostic, refKey, refLabel,
  type Diagnostic, type DocumentRef,
} from '@/content-engine/diagnostics';
import { ID_PATTERN } from '@/content-engine/schema/common';
import { CourseDocumentSchema, type CourseDocument, type ManifestItem } from '@/content-engine/schema/course';
import { parseJsonDocument, parseWorkspace, splitInlineCourse, validateDocument } from '@/content-engine/validate';
import { checkIds } from '@/content-engine/validate/semantic/ids';

export type WorkspaceDraft = {
  id: string; courseId: string; manifest: unknown; items: Record<string, unknown>;
  baseVersionId: string | null; checklist: unknown; updatedAt: string | null;
};
export type WorkspaceSnapshot = { manifest: unknown; items: Record<string, unknown>; baseVersionId?: string | null };

/**
 * Why a mutation was refused. Structural edits (outline changes, title
 * synchronisation, targeted imports) are rejected rather than applied over text
 * the author has not fixed yet, and the reason is carried to the UI instead of
 * being swallowed.
 */
export type MutationFailureCode = 'INVALID_SOURCE' | 'INVALID_MANIFEST' | 'IMMUTABLE_ID' | 'DUPLICATE_ID' | 'UNKNOWN_ITEM';
export type MutationFailure = { code: MutationFailureCode; ref: DocumentRef };

export type WorkspaceState = WorkspaceDraft & {
  /**
   * Authoritative raw editor text, keyed by `refKey` — `course` for the manifest
   * and `item:<id>` for items. An item whose id is literally `manifest` therefore
   * lives at `item:manifest` and can never displace the course manifest.
   */
  sources: Record<string, string>;
  saved: WorkspaceSnapshot;
  mutation: MutationFailure | null;
};

export const COURSE_SOURCE_KEY = refKey(COURSE_REF);
const ITEM_SOURCE_PREFIX = 'item:';
export const itemSourceKey = (id: string): string => refKey(itemRef(id));

/**
 * Inverse of `refKey`, for the keys this module writes and nothing else. A key it
 * does not recognise returns `null` rather than being reinterpreted: slicing a
 * prefix off an arbitrary string would invent a document id (`manifest` would
 * become the item `est`).
 */
export function refFromSourceKey(key: string): DocumentRef | null {
  if (key === COURSE_SOURCE_KEY) return COURSE_REF;
  if (!key.startsWith(ITEM_SOURCE_PREFIX)) return null;
  const id = key.slice(ITEM_SOURCE_PREFIX.length);
  return ID_PATTERN.test(id) ? itemRef(id) : null;
}

class MutationError extends Error {
  constructor(readonly failure: MutationFailure) { super(failure.code); this.name = 'MutationError'; }
}
const fail = (code: MutationFailureCode, ref: DocumentRef): never => { throw new MutationError({ code, ref }); };
export function mutationFailureOf(cause: unknown): MutationFailure | null {
  return cause instanceof MutationError ? cause.failure : null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function sourceOf(value: unknown): string { return JSON.stringify(value, null, 2); }
/**
 * Formatting-insensitive identity of one raw document, via the strict parser.
 *
 * `JSON.parse` would silently keep the last of two identical keys, so text the
 * strict parser rejects could canonicalise to exactly the stored document and read
 * as "no unsaved changes" — losing the author's evidence on the next navigation.
 * Text that does not parse strictly therefore has no canonical form at all: it is
 * tagged so it can only ever compare equal to the identical invalid text, which
 * keeps the edit dirty, recoverable and downloadable.
 */
export type SourceIdentityCache = {
  get: (source: string) => string | undefined;
  remember: (source: string, identity: string) => void;
  serialize: (value: unknown) => string;
  stats: () => { hits: number; misses: number; serializations: number; size: number; limit: number };
};

export function createSourceIdentityCache(limit = 32): SourceIdentityCache {
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 32;
  const entries = new Map<string, string>();
  const serialized = new WeakMap<object, string>();
  let hits = 0;
  let misses = 0;
  let serializations = 0;
  return {
    get(source) {
      const identity = entries.get(source);
      if (identity === undefined) { misses += 1; return undefined; }
      hits += 1;
      entries.delete(source);
      entries.set(source, identity);
      return identity;
    },
    remember(source, identity) {
      entries.delete(source);
      entries.set(source, identity);
      while (entries.size > maximum) entries.delete(entries.keys().next().value!);
    },
    serialize(value) {
      if (typeof value !== 'object' || value === null) return sourceOf(value);
      const cached = serialized.get(value);
      if (cached !== undefined) return cached;
      serializations += 1;
      const source = sourceOf(value);
      serialized.set(value, source);
      return source;
    },
    stats: () => ({ hits, misses, serializations, size: entries.size, limit: maximum }),
  };
}

function sourceIdentity(source: string, value: unknown): string {
  return value === undefined ? `\u0000invalid\u0000${source}` : stableStringify(value);
}

/** Exact source equality while allowing RFC 8259 whitespace only at document edges. */
function sameJsonWithEdgeWhitespace(left: string, right: string): boolean {
  const isWhitespace = (char: string) => char === ' ' || char === '\n' || char === '\r' || char === '\t';
  const bounds = (text: string) => {
    let start = 0;
    let end = text.length;
    while (start < end && isWhitespace(text[start]!)) start += 1;
    while (end > start && isWhitespace(text[end - 1]!)) end -= 1;
    return { start, end };
  };
  const a = bounds(left);
  const b = bounds(right);
  if (a.end - a.start !== b.end - b.start) return false;
  for (let offset = 0; offset < a.end - a.start; offset += 1) {
    if (left.charCodeAt(a.start + offset) !== right.charCodeAt(b.start + offset)) return false;
  }
  return true;
}

export function canonicalSource(source: string, cache?: SourceIdentityCache): string {
  const cached = cache?.get(source);
  if (cached !== undefined) return cached;
  const parsed = parseJsonDocument(source, COURSE_REF);
  const identity = sourceIdentity(source, parsed.errors.length ? undefined : parsed.value);
  cache?.remember(source, identity);
  return identity;
}
function sourcesOf(snapshot: WorkspaceSnapshot, cache?: SourceIdentityCache): Record<string, string> {
  const serialize = cache ? cache.serialize : sourceOf;
  return {
    [COURSE_SOURCE_KEY]: serialize(snapshot.manifest),
    ...Object.fromEntries(Object.entries(snapshot.items).map(([id, item]) => [itemSourceKey(id), serialize(item)])),
  };
}

export function createWorkspaceState(draft: WorkspaceDraft): WorkspaceState {
  // Legacy inline documents are normalized once; orphan documents are retained
  // until explicitly removed. Documents the manifest declares but that were never
  // stored are NOT invented here: an incomplete draft stays readable and reports
  // the missing documents as diagnostics.
  const parsed = CourseDocumentSchema.safeParse(draft.manifest);
  const split = parsed.success ? splitInlineCourse(parsed.data) : null;
  const manifest = split?.manifest ?? draft.manifest;
  const snapshot = { ...draft, manifest, items: { ...(split?.items ?? {}), ...draft.items } };
  return {
    ...snapshot,
    sources: sourcesOf(snapshot),
    saved: { manifest: snapshot.manifest, items: snapshot.items, baseVersionId: snapshot.baseVersionId },
    mutation: null,
  };
}

export function workspaceIsDirty(state: WorkspaceState, cache?: SourceIdentityCache): boolean {
  const savedSources = sourcesOf(state.saved, cache);
  return state.baseVersionId !== state.saved.baseVersionId
    || Object.keys(state.sources).length !== Object.keys(savedSources).length
    || Object.entries(state.sources).some(([key, source]) => canonicalSource(source, cache) !== canonicalSource(savedSources[key] ?? '', cache));
}

function identityDiagnostic(ref: DocumentRef, path: string): Diagnostic {
  return { ...makeDiagnostic('E_SCHEMA', { ref, path }), message: {
    vi: 'Không thể đổi ID hoặc loại tài liệu hiện có. Hãy tạo bài mới với ID khác.',
    en: 'Existing document IDs and kinds cannot change. Create a new item with a new ID.',
  } };
}
function missingDocumentDiagnostic(ref: DocumentRef, type: string): Diagnostic {
  return makeDiagnostic('E_MISSING_ITEM_DOCUMENT', { ref, path: '', meta: { id: refLabel(ref), type } });
}
function orphanDocumentDiagnostic(ref: DocumentRef): Diagnostic {
  return makeDiagnostic('W_ORPHAN_ITEM_DOCUMENT', { ref, path: '', meta: { id: refLabel(ref) } });
}

/** The kind an existing document is pinned to: its stored kind, else the manifest stub's. */
function expectedItemKind(state: WorkspaceState, id: string): string | undefined {
  const stored = record(state.items[id])?.kind;
  if (typeof stored === 'string') return stored;
  const declared = references(state.manifest).get(id)?.type;
  return typeof declared === 'string' ? declared : undefined;
}

export type WorkspaceSourceAnalysis = { value: unknown; diagnostics: Diagnostic[] };

/** One strict parse + schema/identity pass, reusable by the worker's bounded cache. */
export function analyzeWorkspaceSource(state: WorkspaceState, ref: DocumentRef): WorkspaceSourceAnalysis {
  const source = state.sources[refKey(ref)];
  if (source === undefined) return { value: undefined, diagnostics: [] };
  const parsed = parseJsonDocument(source, ref);
  if (parsed.errors.length) return { value: undefined, diagnostics: parsed.errors };
  const result = validateDocument(parsed.value, refLabel(ref));
  if (!result.ok) return { value: parsed.value, diagnostics: result.diagnostics.map(diagnostic => ({ ...diagnostic, ref })) };
  const row = record(parsed.value)!;
  if (row.id !== (ref.kind === 'course' ? state.courseId : ref.id)) return { value: parsed.value, diagnostics: [identityDiagnostic(ref, '/id')] };
  const expected = ref.kind === 'course' ? 'course' : expectedItemKind(state, ref.id);
  if (expected !== undefined && row.kind !== expected) return { value: parsed.value, diagnostics: [identityDiagnostic(ref, '/kind')] };
  return { value: parsed.value, diagnostics: [] };
}

export function sourceDiagnostics(state: WorkspaceState, ref: DocumentRef): Diagnostic[] {
  return analyzeWorkspaceSource(state, ref).diagnostics;
}

/** Every document reference the workspace currently holds a source for. */
export function workspaceRefs(state: WorkspaceState): DocumentRef[] {
  return Object.keys(state.sources).flatMap(key => {
    const ref = refFromSourceKey(key);
    return ref ? [ref] : [];
  });
}

/**
 * Structural completeness of the raw sources: documents the manifest declares but
 * that have no source, and documents with no manifest declaration. Reported so an
 * incomplete draft is legible; `workspacePayload` refuses to save either way.
 */
export function workspaceStructureDiagnostics(state: WorkspaceState): Diagnostic[] {
  const manifestSource = state.sources[COURSE_SOURCE_KEY];
  if (manifestSource === undefined || sourceDiagnostics(state, COURSE_REF).length) return [];
  const parsed = parseJsonDocument(manifestSource, COURSE_REF);
  const manifest = CourseDocumentSchema.safeParse(parsed.value);
  if (!manifest.success) return [];
  const declared = references(splitInlineCourse(manifest.data).manifest);
  const held = new Set(Object.keys(state.sources).flatMap(key => {
    const ref = refFromSourceKey(key);
    return ref?.kind === 'item' ? [ref.id] : [];
  }));
  return [
    ...[...declared.entries()].filter(([id]) => !held.has(id)).map(([id, stub]) => missingDocumentDiagnostic(itemRef(id), stub.type)),
    ...[...held].filter(id => !declared.has(id)).map(id => orphanDocumentDiagnostic(itemRef(id))),
  ];
}

function references(manifest: unknown): Map<string, ManifestItem> {
  const parsed = CourseDocumentSchema.safeParse(manifest);
  return new Map(parsed.success ? parsed.data.modules.flatMap(module => module.items.map(item => [item.id, item] as const)) : []);
}

export function starterItem(stub: ManifestItem): unknown {
  const base = { schemaVersion: 1, kind: stub.type, id: stub.id, title: stub.title ?? stub.id };
  const paragraph = { type: 'paragraph', content: [{ text: '' }] };
  if (stub.type === 'exam') return { ...base, sections: [{ id: 'section-1', title: '1', questions: [{ id: 'question-1', type: 'true_false', content: { blocks: [paragraph] }, correctAnswer: true }] }] };
  if (stub.type === 'assignment') return { ...base, instructions: { blocks: [paragraph] }, submission: { accepts: ['text'] } };
  return { ...base, blocks: [paragraph] };
}

/**
 * Explicitly scaffolds a starter document for an item the manifest declares but
 * that has never been stored. Only ever called from a deliberate author action —
 * nothing in the load path invents documents.
 */
export function materializeWorkspaceItem(state: WorkspaceState, itemId: string): WorkspaceState {
  const ref = itemRef(itemId);
  if (Object.hasOwn(state.sources, refKey(ref))) return state;
  const stub = references(state.manifest).get(itemId);
  if (!stub) return { ...state, mutation: { code: 'UNKNOWN_ITEM', ref } };
  const item = starterItem(stub);
  return { ...state, items: { ...state.items, [itemId]: item }, sources: { ...state.sources, [refKey(ref)]: sourceOf(item) }, mutation: null };
}

/** Applies a tree change atomically to source strings and parsed documents; never overwrites invalid text. */
export function changeWorkspaceManifest(state: WorkspaceState, value: unknown): WorkspaceState {
  if (sourceDiagnostics(state, COURSE_REF).length) fail('INVALID_SOURCE', COURSE_REF);
  const result = CourseDocumentSchema.safeParse(value);
  if (!result.success) fail('INVALID_MANIFEST', COURSE_REF);
  const manifest = result.data!;
  if (manifest.id !== state.courseId) fail('IMMUTABLE_ID', COURSE_REF);
  const before = references(state.manifest);
  const split = splitInlineCourse(manifest);
  const after = references(split.manifest);
  const items = { ...state.items };
  const sources: Record<string, string> = { ...state.sources, [COURSE_SOURCE_KEY]: sourceOf(split.manifest) };
  for (const [id, previous] of before) {
    const next = after.get(id);
    const affected = !next || stableStringify(next) !== stableStringify(previous) || Object.hasOwn(split.items, id);
    if (affected && sourceDiagnostics(state, itemRef(id)).length) fail('INVALID_SOURCE', itemRef(id));
    if (next && next.type !== previous.type) fail('IMMUTABLE_ID', itemRef(id));
    if (!next) { delete items[id]; delete sources[itemSourceKey(id)]; }
  }
  for (const [id, stub] of after) {
    const previous = before.get(id);
    if (Object.hasOwn(split.items, id)) items[id] = split.items[id];
    else if (!Object.hasOwn(items, id)) items[id] = starterItem(stub);
    else if (stub.title !== undefined && stableStringify(stub.title) !== stableStringify(previous?.title ?? null)) items[id] = { ...record(items[id]), title: stub.title };
    if (!Object.hasOwn(state.items, id) || stableStringify(items[id]) !== stableStringify(state.items[id])) sources[itemSourceKey(id)] = sourceOf(items[id]);
  }
  const parsed = parseWorkspace({ manifest: split.manifest, items });
  if (parsed.parsed && checkIds(parsed.parsed).length) fail('DUPLICATE_ID', COURSE_REF);
  return { ...state, manifest: split.manifest, items, sources, mutation: null };
}

/** Raw JSON stays editable even while invalid; parsed data only advances after structural validation. */
export function changeWorkspaceSource(state: WorkspaceState, ref: DocumentRef, source: string, cache?: SourceIdentityCache): WorkspaceState {
  const key = refKey(ref);
  const next = { ...state, sources: { ...state.sources, [key]: source }, mutation: null };
  const currentDocument = ref.kind === 'course' ? state.manifest : state.items[ref.id];
  if (currentDocument !== undefined) {
    const validatedSource = cache ? cache.serialize(currentDocument) : sourceOf(currentDocument);
    // Token equivalence to the serialization of the last validated document proves
    // this is formatting-only without running the parser or schema on the input path.
    if (sameJsonWithEdgeWhitespace(source, validatedSource)) {
      if (cache) cache.remember(source, cache.get(validatedSource) ?? stableStringify(currentDocument));
      return next;
    }
  }
  const analyzed = analyzeWorkspaceSource(next, ref);
  const identity = sourceIdentity(source, analyzed.value);
  cache?.remember(source, identity);
  if (analyzed.diagnostics.length) return next;
  const value = analyzed.value;
  if (ref.kind === 'course') {
    // Strict parse, schema and identity validation have already succeeded. When
    // only formatting changed, retain the raw text without rebuilding and
    // revalidating the entire course tree on the input event's main-thread path.
    if (identity === canonicalSource(sourceOf(state.manifest), cache)) return next;
    try {
      // Validate the mutation against the last valid manifest, then keep the
      // author's own formatting when the outcome is identical to what they typed.
      const base = { ...state, sources: { ...state.sources, [COURSE_SOURCE_KEY]: sourceOf(state.manifest) } };
      const changed = changeWorkspaceManifest(base, value);
      return { ...changed, sources: { ...changed.sources, [COURSE_SOURCE_KEY]: stableStringify(value) === stableStringify(changed.manifest) ? source : changed.sources[COURSE_SOURCE_KEY] } };
    } catch (cause) {
      const failure = mutationFailureOf(cause);
      if (!failure) throw cause;
      return { ...next, mutation: failure };
    }
  }
  const manifestResult = CourseDocumentSchema.safeParse(state.manifest);
  let manifest: unknown = state.manifest;
  const sources = { ...next.sources };
  // Keep names in both views coherent, without touching a manifest whose source is invalid.
  if (manifestResult.success && !sourceDiagnostics(state, COURSE_REF).length && stableStringify(record(value)?.title ?? null) !== stableStringify(record(state.items[ref.id])?.title ?? null)) {
    manifest = { ...manifestResult.data, modules: manifestResult.data.modules.map(module => ({ ...module, items: module.items.map(item => item.id === ref.id ? { ...item, title: record(value)?.title } : item) })) };
    if (stableStringify(manifest) !== stableStringify(state.manifest)) sources[COURSE_SOURCE_KEY] = sourceOf(manifest);
  }
  return { ...next, manifest, sources, items: { ...state.items, [ref.id]: value } };
}

/**
 * Targeted single-item import. Only the imported document and the manifest change;
 * every unrelated raw source keeps its exact bytes, including sources that are
 * still invalid. A manifest the author has left invalid blocks the import instead
 * of being rewritten underneath them.
 */
export function importWorkspaceItemLocally(
  state: WorkspaceState,
  document: unknown,
  moduleId: string,
): WorkspaceState {
  const row = record(document);
  const id = row?.id;
  const kind = row?.kind;
  if (typeof id !== 'string' || typeof kind !== 'string') fail('INVALID_SOURCE', COURSE_REF);
  const ref = itemRef(id as string);
  if (sourceDiagnostics(state, COURSE_REF).length) fail('INVALID_MANIFEST', COURSE_REF);
  const manifestResult = CourseDocumentSchema.safeParse(state.manifest);
  if (!manifestResult.success) fail('INVALID_MANIFEST', COURSE_REF);
  const existingKind = expectedItemKind(state, id as string);
  if (existingKind !== undefined && existingKind !== kind) fail('IMMUTABLE_ID', ref);

  const manifest = manifestResult.data!;
  const declared = references(manifest).has(id as string);
  const targetModule = declared ? null : manifest.modules.find(module => module.id === moduleId);
  if (!declared && !targetModule) fail('UNKNOWN_ITEM', ref);
  const stub = { id: id as string, type: kind, ...(row!.title === undefined ? {} : { title: row!.title }) } as ManifestItem;
  const nextManifest: CourseDocument = declared
    ? { ...manifest, modules: manifest.modules.map(module => ({ ...module, items: module.items.map(item => item.id === id ? { ...item, ...stub } : item) })) }
    : { ...manifest, modules: manifest.modules.map(module => module.id === moduleId ? { ...module, items: [...module.items, stub] } : module) };

  const sources = { ...state.sources, [refKey(ref)]: sourceOf(document) };
  const manifestSource = sourceOf(nextManifest);
  if (manifestSource !== state.sources[COURSE_SOURCE_KEY]) sources[COURSE_SOURCE_KEY] = manifestSource;
  const items = { ...state.items, [id as string]: document };
  const parsed = parseWorkspace({ manifest: nextManifest, items });
  if (parsed.parsed && checkIds(parsed.parsed).length) fail('DUPLICATE_ID', ref);
  return { ...state, manifest: nextManifest, items, sources, mutation: null };
}

/**
 * Restores raw editor text (from local recovery or an explicit raw-source import).
 * The text is taken verbatim and stays local; parsed documents advance only for
 * the sources that are individually valid, so invalid text is preserved and
 * reported instead of blocking the restore.
 */
export function restoreWorkspaceSources(state: WorkspaceState, sources: Record<string, string>): WorkspaceState {
  // Restoring a map with a key this module cannot produce would materialise a
  // document nobody authored, so the whole restore is refused instead.
  if (!Object.hasOwn(sources, COURSE_SOURCE_KEY) || Object.keys(sources).some(key => refFromSourceKey(key) === null)) {
    fail('INVALID_SOURCE', COURSE_REF);
  }
  const next: WorkspaceState = { ...state, sources: { ...sources }, mutation: null };
  const manifestSource = sources[COURSE_SOURCE_KEY];
  let manifest = state.manifest;
  if (manifestSource !== undefined) {
    const parsed = parseJsonDocument(manifestSource, COURSE_REF);
    const result = parsed.errors.length ? null : CourseDocumentSchema.safeParse(parsed.value);
    if (result?.success && result.data.id === state.courseId) manifest = splitInlineCourse(result.data).manifest;
  }
  const items: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(sources)) {
    if (key === COURSE_SOURCE_KEY) continue;
    const ref = refFromSourceKey(key);
    if (ref?.kind !== 'item') continue;
    const parsed = parseJsonDocument(text, ref);
    if (!parsed.errors.length && record(parsed.value)?.id === ref.id) items[ref.id] = parsed.value;
  }
  return { ...next, manifest, items };
}

export function workspacePayload(state: WorkspaceState): WorkspaceSnapshot | null {
  if (workspaceRefs(state).some(ref => sourceDiagnostics(state, ref).length)) return null;
  const manifestSource = state.sources[COURSE_SOURCE_KEY];
  if (manifestSource === undefined) return null;
  const manifest = parseJsonDocument(manifestSource, COURSE_REF).value as CourseDocument | undefined;
  if (!manifest) return null;
  // A syntactically valid but rejected tree/identity change is still unsaveable.
  if (stableStringify(manifest) !== stableStringify(state.manifest)) return null;
  const itemEntries: [string, unknown][] = [];
  for (const [key, text] of Object.entries(state.sources)) {
    if (key === COURSE_SOURCE_KEY) continue;
    const ref = refFromSourceKey(key);
    // An unrecognised key means the state was not built by this module: refuse
    // rather than guess which document the text belongs to.
    if (!ref || ref.kind !== 'item') return null;
    itemEntries.push([ref.id, parseJsonDocument(text, ref).value]);
  }
  const items = Object.fromEntries(itemEntries);
  const declared = [...references(manifest).keys()];
  if (declared.some(itemId => !Object.hasOwn(items, itemId))) return null;
  if (Object.keys(items).some(itemId => !declared.includes(itemId))) return null;
  const parsed = parseWorkspace({ manifest, items });
  if (!parsed.ok || !parsed.parsed || checkIds(parsed.parsed).length) return null;
  return { manifest, items, baseVersionId: state.baseVersionId };
}

export function replaceWorkspaceLocally(state: WorkspaceState, snapshot: WorkspaceSnapshot): WorkspaceState {
  const parsed = CourseDocumentSchema.safeParse(snapshot.manifest);
  if (!parsed.success) fail('INVALID_MANIFEST', COURSE_REF);
  if (parsed.data!.id !== state.courseId) fail('IMMUTABLE_ID', COURSE_REF);
  const next = createWorkspaceState({ ...state, ...snapshot, baseVersionId: snapshot.baseVersionId === undefined ? state.baseVersionId : snapshot.baseVersionId });
  return { ...next, saved: state.saved, updatedAt: state.updatedAt };
}

export function acceptWorkspaceSave(state: WorkspaceState, saved: WorkspaceDraft): WorkspaceState {
  return { ...state, updatedAt: saved.updatedAt, saved: { manifest: saved.manifest, items: saved.items, baseVersionId: saved.baseVersionId } };
}

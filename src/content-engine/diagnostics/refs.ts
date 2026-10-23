/**
 * Every diagnostic, editor source and per-document record points at exactly one
 * document. `DocumentRef` is that pointer: the course manifest is a kind of its
 * own, so an item whose id happens to be `manifest` is a different document from
 * the manifest itself and can never overwrite it.
 */
export type DocumentRef = { kind: 'course' } | { kind: 'item'; id: string };

/** Legacy wire/display value for the course manifest. Re-exported as `MANIFEST_DOC_ID` from `validate/workspace`. */
const MANIFEST_LABEL = 'manifest';

export const COURSE_REF: DocumentRef = { kind: 'course' };
export const itemRef = (id: string): DocumentRef => ({ kind: 'item', id });

/** Collision-free key for records and maps: `course` or `item:<id>`. */
export const refKey = (ref: DocumentRef): string => (ref.kind === 'course' ? 'course' : `item:${ref.id}`);

/** Legacy `docId` string. Display and wire compatibility only — never a record key. */
export const refLabel = (ref: DocumentRef): string => (ref.kind === 'course' ? MANIFEST_LABEL : ref.id);

/** Adapter for callers that still hold a legacy `docId` string. */
export const refFromDocId = (docId: string): DocumentRef => (docId === MANIFEST_LABEL ? COURSE_REF : itemRef(docId));

export const sameRef = (a: DocumentRef, b: DocumentRef): boolean => refKey(a) === refKey(b);

export const isCourseRef = (ref: DocumentRef): ref is { kind: 'course' } => ref.kind === 'course';

/** Accepts either form so existing call sites keep compiling. */
export const toRef = (doc: string | DocumentRef): DocumentRef => (typeof doc === 'string' ? refFromDocId(doc) : doc);

/** Reads a diagnostic's reference, falling back to the legacy label for older producers. */
export const refOf = (d: { ref?: DocumentRef; docId: string }): DocumentRef => d.ref ?? refFromDocId(d.docId);

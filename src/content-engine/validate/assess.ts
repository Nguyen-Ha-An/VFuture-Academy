import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic } from '../diagnostics';
import { isLocaleMap } from '../schema/common';
import { isInlineItem, type CourseDocument } from '../schema/course';
import { checkIds } from './semantic/ids';
import { validateDocument } from './structural';
import { ITEM_KINDS, ownEntry, parseWorkspace, type CourseWorkspace, type ParsedWorkspace } from './workspace';

export interface WorkspaceAssessmentOptions {
  /** Route/course this workspace claims to be. A mismatch is an error, never a rename. */
  courseId?: string;
  /**
   * Server writes, imports and publication need a workspace that stands on its own:
   * every document is declared by the manifest. Read paths leave an orphan as a
   * warning so an already-inconsistent draft stays openable and fixable.
   */
  requireComplete?: boolean;
}

export interface WorkspaceAssessment {
  ok: boolean;
  /** Present whenever the manifest itself is a structurally valid course document. */
  parsed?: ParsedWorkspace;
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

const split = (diagnostics: Diagnostic[]): WorkspaceAssessment => {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return { ok: errors.length === 0, diagnostics, errors, warnings: diagnostics.filter((d) => d.severity !== 'error') };
};

/** Comparable form of a title: a plain string as-is, a locale map as its entries sorted by key. `null` = absent. */
function normalizeTitle(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (isLocaleMap(v)) return JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return null;
}

/** Ids whose body is inline in the manifest rather than a separate document. */
function inlineItemIds(manifest: CourseDocument): Set<string> {
  const ids = new Set<string>();
  for (const moduleRow of manifest.modules) for (const item of moduleRow.items) if (isInlineItem(item)) ids.add(item.id);
  return ids;
}

/**
 * The one implementation of workspace identity: does this collection of documents
 * describe a single coherent course?
 *
 * The editor, the save route, imports, preview and publication each used to answer
 * that separately, which is how the client came to accept workspaces the server then
 * rejected. Nothing here repairs anything: no reserved ids, no invented documents,
 * no renames — a disagreement is reported, not resolved.
 */
export function assessWorkspace(ws: CourseWorkspace, opts: WorkspaceAssessmentOptions = {}): WorkspaceAssessment {
  if (ws.parseDiagnostics?.length) return split([...ws.parseDiagnostics]);

  const diagnostics: Diagnostic[] = [];
  const manifestResult = validateDocument(ws.manifest, COURSE_REF);
  if (!manifestResult.ok) return split(manifestResult.diagnostics);
  if (manifestResult.kind !== 'course') {
    return split([makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref: COURSE_REF, path: '/kind', meta: { id: 'manifest', expected: 'course', received: manifestResult.kind } })]);
  }
  const manifest = manifestResult.doc;
  if (opts.courseId !== undefined && manifest.id !== opts.courseId) {
    diagnostics.push(makeDiagnostic('E_WORKSPACE_ID_MISMATCH', { ref: COURSE_REF, path: '/id', meta: { received: manifest.id, expected: opts.courseId } }));
  }

  // Declarations are classified before anything is keyed by id, so a duplicate stub
  // is reported instead of quietly winning the map slot.
  const declared = new Map<string, { type: string; title: unknown; path: string }>();
  manifest.modules.forEach((moduleRow, moduleIndex) => moduleRow.items.forEach((stub, itemIndex) => {
    const path = `/modules/${moduleIndex}/items/${itemIndex}`;
    if (declared.has(stub.id)) diagnostics.push(makeDiagnostic('E_DUPLICATE_ID', { ref: COURSE_REF, path: `${path}/id`, meta: { id: stub.id } }));
    else declared.set(stub.id, { type: stub.type, title: (stub as { title?: unknown }).title, path });
  }));

  const inline = inlineItemIds(manifest);
  const documented = new Set<string>();
  const structurallyInvalid = new Set<string>();

  for (const [itemId, raw] of Object.entries(ws.items)) {
    const ref = itemRef(itemId);
    documented.add(itemId);
    const stub = declared.get(itemId);

    // Whether the manifest declares this document does not depend on the document
    // being well-formed. Checking declaration first means a stray file that also
    // fails its schema is still reported as stray, rather than disappearing behind
    // its own schema errors.
    if (!stub) {
      diagnostics.push(opts.requireComplete
        ? makeDiagnostic('E_ORPHAN_ITEM_DOCUMENT', { ref, path: '', meta: { id: itemId } })
        : makeDiagnostic('W_ORPHAN_ITEM_DOCUMENT', { ref, path: '', meta: { id: itemId } }));
    }

    const itemResult = validateDocument(raw, ref);
    if (!itemResult.ok) { diagnostics.push(...itemResult.diagnostics); structurallyInvalid.add(itemId); continue; }
    if (!(ITEM_KINDS as readonly string[]).includes(itemResult.kind)) {
      diagnostics.push(makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref, path: '/kind', meta: { id: itemId, expected: ITEM_KINDS.join(' | '), received: itemResult.kind } }));
      structurallyInvalid.add(itemId);
      continue;
    }
    if (itemResult.doc.id !== itemId) {
      diagnostics.push(makeDiagnostic('E_ITEM_ID_MISMATCH', { ref, path: '/id', meta: { received: itemResult.doc.id, expected: itemId } }));
    }
    if (!stub) continue;
    if (stub.type !== itemResult.kind) {
      diagnostics.push(makeDiagnostic('E_ITEM_KIND_MISMATCH', { ref: COURSE_REF, path: `${stub.path}/type`, meta: { id: itemId, expected: stub.type, received: itemResult.kind } }));
      continue;
    }
    const stubTitle = normalizeTitle(stub.title);
    if (stubTitle !== null && stubTitle !== normalizeTitle((itemResult.doc as { title?: unknown }).title)) {
      diagnostics.push(makeDiagnostic('W_STUB_METADATA_MISMATCH', { ref: COURSE_REF, path: `${stub.path}/title`, meta: { id: itemId } }));
    }
  }

  for (const [id, stub] of declared) {
    // A document that failed structural validation is not also "missing" — its own
    // errors are already reported, and inline items carry their body in the manifest.
    if (documented.has(id) || inline.has(id) || structurallyInvalid.has(id)) continue;
    diagnostics.push(makeDiagnostic('E_MISSING_ITEM_DOCUMENT', { ref: COURSE_REF, path: stub.path, meta: { id, type: stub.type } }));
  }

  // The parser sees things this pass cannot — an item whose body is both inline in
  // the manifest and a separate document, for one — so its diagnostics are carried
  // through rather than dropped. Overlapping reports collapse by identity.
  const parse = parseWorkspace(ws);
  if (parse.parsed) diagnostics.push(...checkIds(parse.parsed));
  const merged = dedupe([...diagnostics, ...parse.diagnostics]);
  return { ...split(merged), ...(parse.parsed ? { parsed: parse.parsed } : {}) };
}

/** Same code, same document, same pointer: one report. */
function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    const key = `${d.code}|${d.docId}|${d.path}|${d.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export { ownEntry };

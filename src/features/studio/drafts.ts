import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';

import { compileCourse, type CompiledCourse, type CompiledItem } from '@/content-engine/compile';
import { emptySummary, makeDiagnostic, type ValidationReport } from '@/content-engine/diagnostics';
import { CourseDocumentSchema } from '@/content-engine/schema/course';
import { IdSchema, type Locale } from '@/content-engine/schema/common';
import { DocumentSchema } from '@/content-engine/schema/document';
import {
  assessWorkspace,
  canonicalWorkspaceSnapshot,
  documentSizeDiagnostics,
  inlineWorkspace,
  parseJsonDocument,
  parseWorkspace,
  perOperationResolver,
  sameWorkspaceSnapshot,
  sourceKeyOf,
  splitInlineCourse,
  validateDocument,
  validateWorkspace,
  workspaceFromDocuments,
  workspaceRevision,
  type CourseWorkspace,
  type ReferenceResolver,
  type WorkspaceSnapshot,
} from '@/content-engine/validate';
import { COURSE_REF, itemRef, refFromDocId, type Diagnostic, type DocumentRef } from '@/content-engine/diagnostics';
import { ApiError, toValidationIssues, type ValidationIssue } from '@/lib/api';
import { audit } from '@/lib/audit';
import type { Actor, Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  categoryForPathway,
  declarationsFromCompiledCourse,
} from '@/features/skills/service';
import { SupabaseResolver, type SupabaseQueryClient } from './resolver';
import { PUBLISH_CHECKLIST_KEYS, type PublishChecklistKey } from './publish-checklist';
import { CourseCreationInputSchema, type CourseCreationInput } from './course-creation';
import { decodeAnyImport } from './content-transfer';
import { readBoundedZipEntry } from './bounded-zip';

type DatabaseError = { message?: string; code?: string } | null;
type QueryResult = { data: unknown; error: DatabaseError };

interface QueryLike extends PromiseLike<QueryResult> {
  select(columns: string): QueryLike;
  insert(value: unknown): QueryLike;
  update(value: unknown): QueryLike;
  upsert(value: unknown, options?: unknown): QueryLike;
  delete(): QueryLike;
  eq(column: string, value: unknown): QueryLike;
  order(column: string, options?: unknown): QueryLike;
  limit(value: number): QueryLike;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export interface StudioDatabase {
  from(table: string): QueryLike;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

export type StudioDependencies = {
  client?: StudioDatabase;
  resolver?: ReferenceResolver;
};

/** Validation-only callers must provide their database boundary explicitly. */
export type SaveabilityDependencies = { client: StudioDatabase };

export type BundleImportHooks = {
  importQuestions?: (document: unknown, actor: Actor) => Promise<void>;
  preflightPersistence?: (requirements: BundleImportRequirements, actor: Actor) => Promise<void> | void;
  validateMedia?: (filename: string, bytes: Uint8Array) => Promise<void> | void;
  uploadMedia?: (filename: string, bytes: Uint8Array) => Promise<{ assetId: string }>;
};

export type BundleImportRequirements = {
  hasAssets: boolean;
  hasQuestions: boolean;
};

export type CourseDraft = {
  id: string;
  courseId: string;
  manifest: unknown;
  items: Record<string, unknown>;
  baseVersionId: string | null;
  checklist: unknown;
  updatedAt: string | null;
  /**
   * Change hint for the stored workspace, additive and optional so existing callers
   * are unaffected. Useful for invalidating a report or preview — but never as proof
   * that a save landed. That question is answered by `storedSnapshotMatches`, which
   * compares the canonical snapshot exactly.
   */
  revision?: string;
};

export const WorkspaceSaveInputSchema = z.object({
  manifest: z.unknown(),
  items: z.record(z.string(), z.unknown()),
  baseVersionId: z.string().uuid().nullable().optional(),
}).strict();

/** The wire form of `DocumentRef`. Validated strictly: no extra keys, no guessing. */
export const DocumentRefSchema = z.union([
  z.object({ kind: z.literal('course') }).strict(),
  z.object({ kind: z.literal('item'), id: IdSchema }).strict(),
]);

/**
 * `selectedRef` is authoritative. The legacy `selectedDocId` cannot express the
 * difference between the course manifest and an item whose id happens to be
 * `manifest`, so it is only consulted when no ref was sent — and the item keeps its
 * id either way.
 */
export const WorkspacePreviewInputSchema = z.object({
  manifest: z.unknown(),
  items: z.record(z.string(), z.unknown()),
  selectedRef: DocumentRefSchema.optional(),
  selectedDocId: z.union([z.literal('manifest'), IdSchema]).optional(),
  locale: z.enum(['vi', 'en']),
}).strict().refine(
  (value) => value.selectedRef !== undefined || value.selectedDocId !== undefined,
  { message: 'selectedRef (or the legacy selectedDocId) is required', path: ['selectedRef'] },
);

export const NewCourseImportInputSchema = z.object({ text: z.string().min(1).max(2 * 1024 * 1024) }).strict();

const ITEM_KINDS = ['lesson', 'exam', 'assignment'] as const;
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 2_000;
const MAX_BUNDLE_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_BUNDLE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_BUNDLE_PATH_LENGTH = 200;
const MAX_ASSET_REWRITE_DEPTH = 64;
const SAFE_BUNDLE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})*$/;

const CONFIRMED = z.literal(true);
// Every item of the shared publish checklist must be confirmed; the keys come from one place.
export const PublishChecklistSchema = z.object(
  Object.fromEntries(PUBLISH_CHECKLIST_KEYS.map((key) => [key, CONFIRMED])) as { [K in PublishChecklistKey]: typeof CONFIRMED },
).strict();

export const PublishInputSchema = z.object({
  checklist: PublishChecklistSchema,
  notes: z.string().max(4_000).nullable().optional(),
}).strict();

function database(deps?: StudioDependencies): StudioDatabase {
  return deps?.client ?? (supabaseService() as unknown as StudioDatabase);
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function issuesFromZod(error: z.ZodError): ValidationIssue[] {
  return toValidationIssues(error.issues);
}

function diagnosticIssues(report: ValidationReport): ValidationIssue[] {
  return toValidationIssues(report.errors);
}

function databaseFailure(message: string): never {
  throw new ApiError(500, 'DATABASE_ERROR', message);
}

function parseDocumentText(text: string, doc: string | DocumentRef): unknown {
  const parsed = parseJsonDocument(text, doc);
  if (parsed.errors.length) {
    throw new ApiError(400, 'INVALID_DOCUMENT', 'Document is not valid JSON', toValidationIssues(parsed.errors));
  }
  return parsed.value;
}

function assertCourseId(courseId: string, document: { id: string }): void {
  if (document.id !== courseId) {
    throw new ApiError(409, 'COURSE_ID_MISMATCH', 'Course document id must match the route course id', [
      { path: ['id'], message: `Expected ${courseId}` },
    ]);
  }
}

function initialManifest(input: CourseCreationInput) {
  return {
    $schema: 'https://academy.vfuturelabs.org/schemas/v1/course.json',
    schemaVersion: 1,
    kind: 'course',
    id: input.id,
    ...(input.id.length > 1 ? { slug: input.id } : {}),
    title: input.title,
    summary: input.title,
    languages: input.languages,
    defaultLanguage: input.defaultLanguage,
    level: input.level,
    difficulty: 'beginner',
    pathway: input.pathway,
    tags: [],
    learningOutcomes: [input.title],
    access: { scope: 'global' },
    enrollment: 'open',
    prerequisites: [],
    skills: [],
    completion: { rules: [{ type: 'all_items' }], certificate: true },
    // The starter item is inline rather than a bare stub. A stub would declare an
    // item with no document — exactly the incomplete workspace a server save now
    // refuses — so the scaffold carries its first lesson's body with it and is
    // completely valid from the first write.
    modules: [{
      id: 'start-here',
      title: input.title,
      items: [{
        type: 'lesson',
        id: 'first-lesson',
        title: input.title,
        required: true,
        blocks: [{ type: 'paragraph', content: [{ text: input.title }] }],
      }],
    }],
    relatedOpportunities: [],
  };
}

/** Lists Studio courses in most-recently-edited order. */
export async function listCourses(deps?: StudioDependencies, scope?: Scope): Promise<unknown[]> {
  let query = database(deps).from('courses').select('id,slug,status,current_version_id,owner_id,created_at,updated_at,ownership_kind,owner_branch_id');
  if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) databaseFailure('Unable to list courses');
  return Array.isArray(data) ? data : [];
}

/** Creates the course shell and an editable starter draft owned by the actor. */
export async function createCourse(input: unknown, actor: Actor, deps?: StudioDependencies) {
  const inputResult = CourseCreationInputSchema.safeParse(input);
  if (!inputResult.success) {
    throw new ApiError(400, 'INVALID_COURSE', 'Initial course failed schema validation', issuesFromZod(inputResult.error));
  }
  const parsed = inputResult.data;
  const manifest = initialManifest(parsed);
  const validation = validateDocument(manifest, 'manifest');
  if (!validation.ok || validation.kind !== 'course') {
    throw new ApiError(400, 'INVALID_COURSE', 'Initial course failed schema validation', toValidationIssues(validation.ok ? [] : validation.diagnostics));
  }
  const client = database(deps);
  const { data, error } = await client.rpc('studio_create_course', {
    p_course_id: parsed.id,
    p_actor_id: actor.userId,
    p_manifest: validation.doc,
  });
  if (error) databaseFailure('Unable to create course');
  const created = object(data);
  const course = object(created?.course);
  const draft = object(created?.draft);
  if (!course || !draft) databaseFailure('Unable to create course');
  return { course, draft };
}

function draftFromSnapshot(value: unknown, courseId: string): CourseDraft {
  const row = object(value);
  const draftId = requiredString(row?.id);
  if (!row || !draftId) throw new ApiError(404, 'DRAFT_NOT_FOUND', 'Course draft not found');
  const rawItems = object(row.items) ?? {};
  const items = { ...rawItems };
  return {
    id: draftId,
    courseId: requiredString(row.course_id) ?? courseId,
    manifest: row.manifest,
    items,
    baseVersionId: requiredString(row.base_version_id),
    checklist: row.checklist ?? {},
    updatedAt: requiredString(row.updated_at),
    revision: workspaceRevision(row.manifest, items),
  };
}

/** Loads the active draft and all item documents from one database snapshot. */
export async function getDraft(courseId: string, deps?: StudioDependencies): Promise<CourseDraft> {
  const { data, error } = await database(deps).rpc('studio_get_draft_snapshot', { course_id: courseId });
  if (error) databaseFailure('Unable to load course draft');
  return draftFromSnapshot(data, courseId);
}

/** A reference lookup that failed is neither a valid course nor an invalid one. */
function assertNoReferenceOutage(diagnostics: readonly Diagnostic[]): void {
  if (!diagnostics.some((d) => d.code === 'E_REFERENCE_LOOKUP_FAILED')) return;
  throw new ApiError(503, 'REFERENCE_LOOKUP_UNAVAILABLE', 'References could not be checked; the workspace was not saved', toValidationIssues(diagnostics.filter((d) => d.code === 'E_REFERENCE_LOOKUP_FAILED')));
}

function failedSaveabilityReport(diagnostics: readonly Diagnostic[]): ValidationReport {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: errors.length === 0,
    errors,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity !== 'error'),
    summary: emptySummary(),
  };
}

/** The shared save gate. The client is acquired only after cheap, local checks pass. */
async function evaluateSaveability(
  courseId: string,
  manifest: unknown,
  items: Record<string, unknown>,
  client: () => StudioDatabase,
  resolver?: ReferenceResolver,
  publish?: boolean,
): Promise<ValidationReport> {
  // The route bounded the envelope; each document inside it still has its own limit.
  const oversized = documentSizeDiagnostics(manifest, items);
  if (oversized.length) return failedSaveabilityReport(oversized);

  const workspace: CourseWorkspace = { manifest, items };
  const identity = assessWorkspace(workspace, { courseId, requireComplete: true });
  if (!identity.ok) return failedSaveabilityReport(identity.diagnostics);

  return validateWorkspace(workspace, resolverFor(client(), { resolver }, courseId), {
    save: true,
    publish,
    courseId,
    revision: workspaceRevision(manifest, items),
  });
}

/**
 * Reports whether a complete workspace would pass the exact Studio save gate.
 * It performs no persistence and never creates its own service client. Reference
 * lookup outages remain diagnostics so a caller can mark them retryable.
 */
export async function saveabilityReport(
  courseId: string,
  manifest: unknown,
  items: Record<string, unknown>,
  deps: SaveabilityDependencies,
): Promise<ValidationReport> {
  if (!deps?.client) throw new Error('Explicit Studio client is required');
  return evaluateSaveability(courseId, manifest, items, () => deps.client);
}

/**
 * Every content write goes through the shared gate before persistence. Preserve
 * the existing HTTP error codes for oversized documents, reference outages and
 * invalid workspaces while the read-only caller receives a report.
 */
async function assertSaveable(
  courseId: string,
  manifest: unknown,
  items: Record<string, unknown>,
  deps: StudioDependencies | undefined,
  opts: { code?: string; message?: string; publish?: boolean } = {},
): Promise<ValidationReport> {
  const code = opts.code ?? 'INVALID_WORKSPACE';
  const message = opts.message ?? 'Workspace cannot be saved';
  const report = await evaluateSaveability(courseId, manifest, items, () => database(deps), deps?.resolver, opts.publish);
  const oversized = report.errors.filter((diagnostic) => diagnostic.code === 'E_LIMIT_EXCEEDED' && diagnostic.meta?.limit === 'bytes');
  if (oversized.length) throw new ApiError(413, 'DOCUMENT_TOO_LARGE', 'A content document exceeds the document size limit', toValidationIssues(oversized));
  assertNoReferenceOutage(report.errors);
  if (!report.ok) throw new ApiError(422, code, message, diagnosticIssues(report));
  return report;
}

/**
 * Exact reconciliation for a save whose outcome is unknown — a timeout, a dropped
 * connection. The client re-reads the stored draft and compares the canonical
 * snapshot it submitted, item by item, including the base version. A hash would only
 * ever be evidence; this is the answer.
 */
export function storedSnapshotMatches(draft: CourseDraft, submitted: WorkspaceSnapshot): boolean {
  return sameWorkspaceSnapshot(
    { manifest: draft.manifest, items: draft.items, baseVersionId: submitted.baseVersionId === undefined ? undefined : draft.baseVersionId },
    submitted,
  );
}

export { canonicalWorkspaceSnapshot, workspaceRevision };

function parseWorkspaceSaveInput(input: unknown): z.output<typeof WorkspaceSaveInputSchema> {
  const result = WorkspaceSaveInputSchema.safeParse(input);
  if (!result.success) throw new ApiError(422, 'INVALID_WORKSPACE', 'Workspace cannot be saved', issuesFromZod(result.error));
  return result.data;
}

/** Replaces a complete stored workspace with one optimistic-concurrency transaction. */
export async function saveWorkspace(
  courseId: string,
  input: unknown,
  actor: Actor,
  expectedUpdatedAt: string | null,
  deps?: StudioDependencies,
): Promise<CourseDraft> {
  if (!expectedUpdatedAt) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required');
  const request = parseWorkspaceSaveInput(input);
  await assertSaveable(courseId, request.manifest, request.items, deps);
  return persistWorkspace(courseId, request.manifest, request.items, actor, expectedUpdatedAt, deps, {
    baseVersionId: request.baseVersionId,
    setBaseVersion: request.baseVersionId !== undefined && request.baseVersionId !== null,
  });
}

/**
 * The single guarded write. Manifest and item documents move together in one
 * transaction under one optimistic-concurrency check, so a validated snapshot is
 * exactly what ends up stored — or nothing is written and neither the content nor
 * the revision moves.
 */
async function persistWorkspace(
  courseId: string,
  manifest: unknown,
  items: Record<string, unknown>,
  actor: Actor,
  expectedUpdatedAt: string,
  deps?: StudioDependencies,
  opts: { baseVersionId?: string | null; setBaseVersion?: boolean } = {},
): Promise<CourseDraft> {
  const { data, error } = await database(deps).rpc('studio_save_draft_workspace', {
    course_id: courseId,
    manifest,
    items,
    actor_id: actor.userId,
    expected_updated_at: expectedUpdatedAt,
    requested_base_version_id: opts.baseVersionId ?? null,
    set_base_version: opts.setBaseVersion ?? false,
  });
  if (error) databaseFailure('Unable to save course workspace');
  if (object(data)?.conflict === true) throw new ApiError(409, 'DRAFT_CONFLICT', 'Course draft changed before this save completed');
  if (object(data)?.invalid_base_version === true) {
    throw new ApiError(422, 'INVALID_BASE_VERSION', 'Base version does not belong to this course');
  }
  if (object(data)?.immutable_kind_conflict === true) {
    throw new ApiError(422, 'IMMUTABLE_ITEM_KIND', 'An existing item kind cannot be changed');
  }
  return draftFromSnapshot(object(data)?.draft, courseId);
}

/**
 * A legacy caller that sends no `If-Match` still gets a compare-and-set: the
 * revision read a moment ago becomes the precondition, so a concurrent write between
 * the read and this one is a conflict rather than a silent overwrite.
 */
function preconditionFor(expectedUpdatedAt: string | null | undefined, stored: CourseDraft): string {
  const precondition = expectedUpdatedAt || stored.updatedAt;
  if (!precondition) throw new ApiError(409, 'DRAFT_CONFLICT', 'Course draft has no revision to write against');
  return precondition;
}

/**
 * Saves the manifest. The response shape is unchanged, but the write is not: the
 * manifest is composed with the stored item documents, the whole workspace is
 * validated, and the result is persisted through the same guarded transaction a full
 * save uses. Updating `course_drafts.manifest` on its own could leave storage in a
 * state the validated snapshot never described.
 */
export async function saveManifest(
  courseId: string,
  manifest: unknown,
  actor: Actor,
  expectedUpdatedAt?: string | null,
  deps?: StudioDependencies,
): Promise<unknown> {
  const result = validateDocument(manifest, COURSE_REF);
  if (!result.ok || result.kind !== 'course') {
    const diagnostics = result.ok
      ? [makeDiagnostic('E_SCHEMA', { ref: COURSE_REF, path: '/kind', meta: { detail: 'Manifest kind must be course' } })]
      : result.diagnostics;
    throw new ApiError(400, 'INVALID_MANIFEST', 'Manifest failed schema validation', toValidationIssues(diagnostics));
  }
  const document = result.doc;
  assertCourseId(courseId, document);
  const client = database(deps);
  const stored = await getDraft(courseId, { ...deps, client });
  await assertSaveable(courseId, document, stored.items, { ...deps, client }, { code: 'INVALID_MANIFEST', message: 'Manifest cannot be saved' });
  await persistWorkspace(courseId, document, stored.items, actor, preconditionFor(expectedUpdatedAt, stored), { ...deps, client });
  return document;
}

/**
 * Saves one item document. Same response shape as before, but the item now moves
 * through the workspace transaction instead of a reserved timestamp followed by a
 * separate row upsert — two writes that could disagree, and that advanced the
 * draft revision even when the second one failed.
 */
export async function saveItem(
  courseId: string,
  itemId: string,
  document: unknown,
  actor: Actor,
  expectedUpdatedAt?: string | null,
  deps?: StudioDependencies,
): Promise<unknown> {
  const result = validateDocument(document, itemRef(itemId));
  if (!result.ok || !(ITEM_KINDS as readonly string[]).includes(result.kind)) {
    const diagnostics = result.ok
      ? [makeDiagnostic('E_SCHEMA', { ref: itemRef(itemId), path: '/kind', meta: { detail: 'Item kind must be lesson, exam, or assignment' } })]
      : result.diagnostics;
    throw new ApiError(400, 'INVALID_ITEM', 'Item failed schema validation', toValidationIssues(diagnostics));
  }
  const item = result.doc;
  if (item.id !== itemId) {
    throw new ApiError(409, 'ITEM_ID_MISMATCH', 'Item document id must match the route item id', [{ path: ['id'], message: `Expected ${itemId}` }]);
  }
  const client = database(deps);
  const stored = await getDraft(courseId, { ...deps, client });
  const items = { ...stored.items, [itemId]: item };
  // One item is still one edit to the whole workspace: the composed result has to
  // satisfy the same contract as a full save, or an undeclared or wrong-kind
  // document would land in storage through the legacy per-item route.
  await assertSaveable(courseId, stored.manifest, items, { ...deps, client }, { code: 'INVALID_ITEM', message: 'Item cannot be saved' });
  await persistWorkspace(courseId, stored.manifest, items, actor, preconditionFor(expectedUpdatedAt, stored), { ...deps, client });
  return item;
}

/**
 * Removes an item: its manifest stub and its document together.
 *
 * The stub used to be removed while the document row was kept as an orphan, which
 * left storage in a state a save could no longer reproduce. Both go, in one
 * transaction, and the remaining workspace has to be valid on its own.
 */
export async function deleteItem(courseId: string, itemId: string, actor: Actor, deps?: StudioDependencies, expectedUpdatedAt?: string): Promise<unknown> {
  const client = database(deps);
  const draft = await getDraft(courseId, { ...deps, client });
  const manifest = structuredClone(draft.manifest);
  const root = object(manifest);
  if (!root || !Array.isArray(root.modules)) throw new ApiError(400, 'INVALID_MANIFEST', 'Manifest modules must be an array');
  root.modules = root.modules.map((value) => {
    const moduleRow = object(value);
    if (!moduleRow || !Array.isArray(moduleRow.items)) return value;
    return { ...moduleRow, items: moduleRow.items.filter((entry) => object(entry)?.id !== itemId) };
  });
  const items = Object.fromEntries(Object.entries(draft.items).filter(([id]) => id !== itemId));
  await assertSaveable(courseId, manifest, items, { ...deps, client }, { code: 'INVALID_WORKSPACE', message: 'Item cannot be removed' });
  await persistWorkspace(courseId, manifest, items, actor, preconditionFor(expectedUpdatedAt, draft), { ...deps, client }, {
    baseVersionId: draft.baseVersionId,
  });
  return manifest;
}

/**
 * Wholesale draft replacement, always compare-and-set.
 *
 * The unguarded variant existed for callers that had no `If-Match`; it would happily
 * overwrite an edit made between the read and the write. Those callers now supply the
 * revision they read instead, so every replacement is a conflict or nothing.
 */
async function replaceDraft(
  courseId: string,
  manifest: unknown,
  items: Record<string, unknown>,
  baseVersionId: string | null,
  deps: StudioDependencies | undefined,
  expectedUpdatedAt: string,
) {
  const { data, error } = await database(deps).rpc('studio_replace_draft_if_current', {
    course_id: courseId,
    manifest,
    items,
    base_version_id: baseVersionId,
    expected_updated_at: expectedUpdatedAt,
  });
  if (error) databaseFailure('Unable to replace course draft');
  if (object(data)?.conflict === true) {
    throw new ApiError(409, 'DRAFT_CONFLICT', 'Course draft changed before this import completed');
  }
  return data;
}

/** The revision to write against: the caller's `If-Match`, or the one just read. */
async function draftPrecondition(courseId: string, expectedUpdatedAt: string | undefined, deps?: StudioDependencies): Promise<{ precondition: string; draft: CourseDraft }> {
  const draft = await getDraft(courseId, deps);
  return { precondition: preconditionFor(expectedUpdatedAt, draft), draft };
}

/** Imports a complete inline course document and atomically explodes its items. */
export async function importSingle(
  courseId: string,
  text: string,
  _actor: Actor,
  deps?: StudioDependencies,
  expectedUpdatedAt?: string,
) {
  const snapshot = decodeCourseOrWorkspace(text, courseId);
  const client = database(deps);
  const { precondition } = await draftPrecondition(courseId, expectedUpdatedAt, { ...deps, client });
  await assertSaveable(courseId, snapshot.manifest, snapshot.items, { ...deps, client }, { code: 'INVALID_COURSE', message: 'Course document cannot be imported' });
  // An imported snapshot's own base version belongs to wherever it came from; this
  // course's base version is not something an uploaded file gets to set.
  await replaceDraft(courseId, snapshot.manifest, snapshot.items, null, { ...deps, client }, precondition);
  return { manifest: snapshot.manifest, items: snapshot.items };
}

/**
 * Decodes the two forms a course import may legitimately take, through the same pure
 * codec the editor uses: the portable single-file inline course, and the lossless
 * `{ manifest, items }` workspace backup (bare or kinded).
 *
 * The UI accepting a backup that the server then refused was a real mismatch — one
 * decoder now answers for both. A standalone item or a raw-source recovery record is
 * not a course, and is refused here rather than half-applied.
 */
function decodeCourseOrWorkspace(text: string, courseId?: string): { manifest: unknown; items: Record<string, unknown> } {
  const decoded = decodeAnyImport(text, courseId);
  if (!decoded.ok) {
    throw new ApiError(422, 'INVALID_COURSE', 'Course document failed validation', toValidationIssues(decoded.diagnostics));
  }
  const value = decoded.value;
  if (value.form === 'item') {
    throw new ApiError(422, 'INVALID_COURSE', 'This file is a single item document, not a course', [
      { path: ['kind'], message: 'Import a complete course or a workspace backup; add an item from the item import instead' },
    ]);
  }
  if (value.form === 'recovery') {
    throw new ApiError(422, 'INVALID_COURSE', 'This file is a local recovery record, not a course', [
      { path: ['kind'], message: 'Restore a recovery record in the editor; the server accepts only complete, valid content' },
    ]);
  }
  return { manifest: value.snapshot.manifest, items: value.snapshot.items };
}

/** Creates a course and its complete draft in one transaction. */
export async function importNewCourse(text: string, actor: Actor, deps?: StudioDependencies): Promise<{ draft: CourseDraft }> {
  const snapshot = decodeCourseOrWorkspace(text);
  const manifestId = requiredString(object(snapshot.manifest)?.id);
  if (!manifestId) {
    throw new ApiError(422, 'INVALID_COURSE', 'Course document must declare an id', [{ path: ['manifest', 'id'], message: 'A course id is required' }]);
  }
  await assertSaveable(manifestId, snapshot.manifest, snapshot.items, deps, { code: 'INVALID_COURSE', message: 'Course document cannot be imported' });
  const { data, error } = await database(deps).rpc('studio_import_course', {
    course_id: manifestId,
    actor_id: actor.userId,
    manifest: snapshot.manifest,
    items: snapshot.items,
    // Creation owns its own history: a base version id carried in from another
    // course's backup is deliberately not attached to the new draft.
    base_version_id: null,
  });
  if (error) databaseFailure('Unable to import course');
  if (object(data)?.conflict === true) throw new ApiError(409, 'COURSE_EXISTS', 'A course with this id already exists');
  return { draft: draftFromSnapshot(object(data)?.draft, manifestId) };
}

function assertSafeBundlePath(value: string, entryName: string): string {
  const segments = value.split('/');
  const invalid = value.length === 0
    || value.length > MAX_BUNDLE_PATH_LENGTH
    || /^[A-Za-z]:/.test(value)
    || value.startsWith('/')
    || /[\0-\x1f\x7f]/.test(value)
    || segments.includes('..')
    || !SAFE_BUNDLE_PATH.test(value);
  if (invalid) {
    throw new ApiError(400, 'BUNDLE_PATH_INVALID', `Bundle entry has an unsafe path: ${entryName}`, [
      { path: ['name'], message: 'Bundle paths must use short alphanumeric, dot, underscore, dash, and slash segments' },
    ]);
  }
  return value;
}

function assertNoBundleTraversal(entryName: string): void {
  const normalized = entryName.replaceAll('\\', '/');
  if (normalized.startsWith('/')
      || /^[A-Za-z]:/.test(normalized)
      || /[\0-\x1f\x7f]/.test(normalized)
      || normalized.split('/').includes('..')) {
    throw new ApiError(400, 'BUNDLE_PATH_INVALID', `Bundle entry has an unsafe path: ${entryName}`, [
      { path: ['name'], message: 'Bundle paths cannot be absolute, contain control characters, or traverse parent directories' },
    ]);
  }
}

function bundlePath(entryName: string, prefix: 'assets' | 'items' | 'questions'): string {
  const normalized = entryName.replaceAll('\\', '/');
  return assertSafeBundlePath(normalized.slice(prefix.length + 1), entryName);
}

function normalizeAssetName(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^assets\//, '');
  return assertSafeBundlePath(normalized, value);
}

/**
 * The placeholder id used when no upload hook is supplied. Deterministic and
 * exported because it is what the rewritten documents actually reference: a caller
 * that stubs assets can predict the ids, and validation is run against them rather
 * than against the original filenames.
 */
export function stubAssetId(filename: string): string {
  return `asset_stub_${createHash('sha256').update(filename, 'utf8').digest('hex')}`;
}

function pointerSegment(value: string | number): string {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function rewriteAssetReferences(
  value: unknown,
  assets: Map<string, string>,
  docId = 'bundle',
  depth = 0,
  path = '',
): unknown {
  if (depth > MAX_ASSET_REWRITE_DEPTH) {
    throw new ApiError(400, 'BUNDLE_NESTING_TOO_DEEP', 'Bundle document nesting exceeds 64 levels', [
      ...toValidationIssues([makeDiagnostic('E_LIMIT_EXCEEDED', {
        docId,
        path,
        meta: { limit: 'depth', received: depth, expected: MAX_ASSET_REWRITE_DEPTH },
      })]),
    ]);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => rewriteAssetReferences(entry, assets, docId, depth + 1, `${path}/${index}`));
  }
  const current = object(value);
  if (!current) return value;
  const rewritten = Object.fromEntries(Object.entries(current).map(([key, nested]) => [
    key,
    rewriteAssetReferences(nested, assets, docId, depth + 1, `${path}/${pointerSegment(key)}`),
  ]));
  if (typeof current.url === 'string' && current.url.startsWith('asset:')) {
    const filename = normalizeAssetName(current.url.slice('asset:'.length));
    const assetId = assets.get(filename);
    if (!assetId) throw new ApiError(400, 'BUNDLE_ASSET_MISSING', `Bundle asset is missing: ${filename}`, [{ path: ['url'], message: `Missing assets/${filename}` }]);
    delete rewritten.url;
    rewritten.assetId = assetId;
  }
  return rewritten;
}

type ZipEntryMetadata = JSZip.JSZipObject & {
  unsafeOriginalName?: string;
  uncompressedSize?: number;
  _data?: { uncompressedSize?: number };
};

function originalEntryName(entry: JSZip.JSZipObject): string {
  return (entry as ZipEntryMetadata).unsafeOriginalName ?? entry.name;
}

function isSymlink(entry: JSZip.JSZipObject): boolean {
  const permissions = entry.unixPermissions;
  if (permissions === null || permissions === undefined) return false;
  const mode = typeof permissions === 'number' ? permissions : Number.parseInt(permissions, 8);
  return Number.isFinite(mode) && (mode & 0o170000) === 0o120000;
}

function entrySize(entry: JSZip.JSZipObject): number {
  if (entry.dir) return 0;
  const metadata = entry as ZipEntryMetadata;
  const size = metadata._data?.uncompressedSize ?? metadata.uncompressedSize;
  if (!Number.isSafeInteger(size) || (size ?? -1) < 0) {
    throw new ApiError(400, 'INVALID_BUNDLE', `Bundle entry has invalid size metadata: ${entry.name}`);
  }
  return size as number;
}

function invalidCentralDirectory(message: string): never {
  throw new ApiError(400, 'INVALID_BUNDLE', message);
}

function endOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimumOffset = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  return invalidCentralDirectory('Bundle has no valid end-of-central-directory record');
}

/** Reads raw central-directory records so duplicate names cannot be hidden by JSZip's object map. */
function preflightRawBundle(bytes: Uint8Array): void {
  if (bytes.byteLength < 22) invalidCentralDirectory('Bundle is too short to be a valid zip file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = endOfCentralDirectory(bytes, view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const advertisedEntries = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== advertisedEntries) {
    invalidCentralDirectory('Multi-disk zip bundles are not supported');
  }
  if (advertisedEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    invalidCentralDirectory('ZIP64 bundles are not supported');
  }
  const directoryEnd = directoryOffset + directorySize;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > endOffset) {
    invalidCentralDirectory('Bundle central directory is out of bounds');
  }

  const names = new Set<string>();
  const decoder = new TextDecoder();
  let cursor = directoryOffset;
  let entryCount = 0;
  let uncompressedBytes = 0;
  while (cursor < directoryEnd) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) {
      invalidCentralDirectory('Bundle central directory contains an invalid entry');
    }
    const madeBy = view.getUint16(cursor + 4, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (nextCursor > directoryEnd || uncompressedSize === 0xffffffff) {
      invalidCentralDirectory('Bundle central directory entry is out of bounds or requires ZIP64');
    }

    entryCount += 1;
    if (entryCount > MAX_BUNDLE_ENTRIES) {
      throw new ApiError(413, 'BUNDLE_TOO_MANY_ENTRIES', `Bundle exceeds the ${MAX_BUNDLE_ENTRIES} entry limit`);
    }
    const entryName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const normalizedName = entryName.replaceAll('\\', '/');
    if (names.has(normalizedName)) {
      throw new ApiError(400, 'BUNDLE_DUPLICATE_ENTRY', `Bundle contains a duplicate entry: ${entryName}`);
    }
    names.add(normalizedName);

    const unixMode = externalAttributes >>> 16;
    if ((madeBy >>> 8) === 3 && (unixMode & 0o170000) === 0o120000) {
      throw new ApiError(400, 'BUNDLE_SYMLINK_FORBIDDEN', `Bundle symlinks are not allowed: ${entryName}`);
    }
    const directory = normalizedName.endsWith('/');
    if (!directory) {
      if (uncompressedSize > MAX_BUNDLE_ENTRY_BYTES) {
        throw new ApiError(413, 'BUNDLE_ENTRY_TOO_LARGE', `Bundle entry exceeds the 20 MB limit: ${entryName}`);
      }
      uncompressedBytes += uncompressedSize;
      if (uncompressedBytes > MAX_BUNDLE_UNCOMPRESSED_BYTES) {
        throw new ApiError(413, 'BUNDLE_UNCOMPRESSED_TOO_LARGE', 'Bundle exceeds the 100 MB uncompressed limit');
      }
      assertNoBundleTraversal(entryName);
      for (const prefix of ['assets', 'items', 'questions'] as const) {
        if (normalizedName.startsWith(`${prefix}/`)) bundlePath(entryName, prefix);
      }
    }
    cursor = nextCursor;
  }
  if (cursor !== directoryEnd || entryCount !== advertisedEntries) {
    invalidCentralDirectory('Bundle central-directory entry count is inconsistent');
  }
}

function preflightBundle(zip: JSZip): JSZip.JSZipObject[] {
  const entries = Object.values(zip.files);
  if (entries.length > MAX_BUNDLE_ENTRIES) {
    throw new ApiError(413, 'BUNDLE_TOO_MANY_ENTRIES', `Bundle exceeds the ${MAX_BUNDLE_ENTRIES} entry limit`);
  }

  let uncompressedBytes = 0;
  for (const entry of entries) {
    if (isSymlink(entry)) throw new ApiError(400, 'BUNDLE_SYMLINK_FORBIDDEN', `Bundle symlinks are not allowed: ${entry.name}`);
    if (entry.dir) continue;
    const size = entrySize(entry);
    if (size > MAX_BUNDLE_ENTRY_BYTES) {
      throw new ApiError(413, 'BUNDLE_ENTRY_TOO_LARGE', `Bundle entry exceeds the 20 MB limit: ${entry.name}`);
    }
    uncompressedBytes += size;
    if (uncompressedBytes > MAX_BUNDLE_UNCOMPRESSED_BYTES) {
      throw new ApiError(413, 'BUNDLE_UNCOMPRESSED_TOO_LARGE', 'Bundle exceeds the 100 MB uncompressed limit');
    }

    const originalName = originalEntryName(entry);
    assertNoBundleTraversal(originalName);
    const normalized = originalName.replaceAll('\\', '/');
    for (const prefix of ['assets', 'items', 'questions'] as const) {
      if (normalized.startsWith(`${prefix}/`)) bundlePath(originalName, prefix);
    }
  }
  return entries;
}

/** Imports the documented zip layout and atomically replaces the draft workspace. */
export async function importBundle(
  courseId: string,
  input: ArrayBuffer | Uint8Array,
  actor: Actor,
  hooks: BundleImportHooks = {},
  deps?: StudioDependencies,
  expectedUpdatedAt?: string,
) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new ApiError(413, 'BUNDLE_TOO_LARGE', 'Bundle exceeds the 50 MB limit');
  preflightRawBundle(bytes);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ApiError(400, 'INVALID_BUNDLE', 'Bundle must be a valid zip file');
  }
  const entries = preflightBundle(zip);
  const courseEntry = zip.file('course.json');
  if (!courseEntry) throw new ApiError(400, 'BUNDLE_COURSE_MISSING', 'Bundle must contain course.json');

  const byteBudget = { used: 0, entryLimit: MAX_BUNDLE_ENTRY_BYTES, totalLimit: MAX_BUNDLE_UNCOMPRESSED_BYTES };
  const readEntry = (entry: JSZip.JSZipObject) => readBoundedZipEntry(entry, byteBudget);
  const readText = async (entry: JSZip.JSZipObject) => new TextDecoder().decode(await readEntry(entry));

  const assetEntries = entries.filter((entry) => !entry.dir && entry.name.replaceAll('\\', '/').startsWith('assets/'));
  const assetFiles: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const entry of assetEntries) {
    const filename = bundlePath(entry.name, 'assets');
    const assetBytes = await readEntry(entry);
    await hooks.validateMedia?.(filename, assetBytes);
    assetFiles.push({ filename, bytes: assetBytes });
  }
  const preflightAssetIds = new Map(assetFiles.map(({ filename }) => [filename, stubAssetId(filename)]));
  const courseSource = parseDocumentText(await readText(courseEntry), 'manifest');
  const coursePreflight = CourseDocumentSchema.safeParse(rewriteAssetReferences(courseSource, preflightAssetIds, 'manifest'));
  if (!coursePreflight.success) throw new ApiError(400, 'INVALID_COURSE', 'course.json failed schema validation', issuesFromZod(coursePreflight.error));
  assertCourseId(courseId, coursePreflight.data);

  const itemEntries = entries.filter((entry) => !entry.dir
    && entry.name.replaceAll('\\', '/').startsWith('items/')
    && bundlePath(entry.name, 'items').toLowerCase().endsWith('.json'));
  const itemDocuments: Array<{ entryName: string; document: unknown }> = [];
  const inline = splitInlineCourse(coursePreflight.data);
  const itemIds = new Set(Object.keys(inline.items));
  for (const entry of itemEntries) {
    const document = parseDocumentText(await readText(entry), entry.name);
    const result = DocumentSchema.safeParse(rewriteAssetReferences(document, preflightAssetIds, entry.name));
    if (!result.success || !ITEM_KINDS.includes(result.data.kind as (typeof ITEM_KINDS)[number])) {
      const issues = result.success ? [{ path: ['kind'], message: 'Bundle item must be a lesson, exam, or assignment' }] : issuesFromZod(result.error);
      throw new ApiError(400, 'INVALID_BUNDLE_ITEM', `Invalid item document: ${entry.name}`, issues);
    }
    if (itemIds.has(result.data.id)) {
      throw new ApiError(409, 'DUPLICATE_BUNDLE_DOCUMENT', `Bundle item id is duplicated: ${result.data.id}`, [
        { path: [entry.name, 'id'], message: `Duplicate item id: ${result.data.id}` },
      ]);
    }
    itemIds.add(result.data.id);
    itemDocuments.push({ entryName: entry.name, document });
  }

  const questionEntries = entries.filter((entry) => !entry.dir
    && entry.name.replaceAll('\\', '/').startsWith('questions/')
    && bundlePath(entry.name, 'questions').toLowerCase().endsWith('.json'));
  const questionDocuments: Array<{ entryName: string; document: unknown }> = [];
  const questionIds = new Set<string>();
  for (const entry of questionEntries) {
    const questionDocument = parseDocumentText(await readText(entry), entry.name);
    const questionResult = validateDocument(rewriteAssetReferences(questionDocument, preflightAssetIds, entry.name), entry.name);
    if (!questionResult.ok || questionResult.kind !== 'question_bundle') {
      const diagnostics = questionResult.ok
        ? [makeDiagnostic('E_SCHEMA', { docId: entry.name, path: '/kind', meta: { detail: 'Question document kind must be question_bundle' } })]
        : questionResult.diagnostics;
      throw new ApiError(400, 'INVALID_BUNDLE_QUESTION', `Invalid question document: ${entry.name}`, toValidationIssues(diagnostics));
    }
    const questions = object(questionResult.doc)?.questions;
    for (const question of Array.isArray(questions) ? questions : []) {
      const id = requiredString(object(question)?.id);
      if (!id) continue;
      if (questionIds.has(id)) {
        throw new ApiError(409, 'DUPLICATE_BUNDLE_QUESTION', `Bundle question id is duplicated: ${id}`, [
          { path: [entry.name, 'questions', id], message: `Duplicate question id: ${id}` },
        ]);
      }
      questionIds.add(id);
    }
    questionDocuments.push({ entryName: entry.name, document: questionDocument });
  }

  const persistenceRequirements = {
    hasAssets: assetFiles.length > 0,
    hasQuestions: questionDocuments.length > 0,
  };
  if (persistenceRequirements.hasAssets || persistenceRequirements.hasQuestions) {
    await hooks.preflightPersistence?.(persistenceRequirements, actor);
  }

  const warnings = { skippedQuestions: [] as string[], stubbedAssets: [] as string[] };
  const uploadMedia = hooks.uploadMedia ?? (async (filename: string) => {
    warnings.stubbedAssets.push(filename);
    return { assetId: stubAssetId(filename) };
  });
  const assetIds = new Map<string, string>();
  for (const { filename, bytes: assetBytes } of assetFiles) {
    const upload = await uploadMedia(filename, assetBytes);
    assetIds.set(filename, upload.assetId);
  }

  const courseRaw = rewriteAssetReferences(courseSource, assetIds, 'manifest');
  const courseResult = CourseDocumentSchema.safeParse(courseRaw);
  if (!courseResult.success) throw new ApiError(400, 'INVALID_COURSE', 'course.json failed schema validation', issuesFromZod(courseResult.error));
  const documents: unknown[] = [courseResult.data];
  for (const { entryName, document } of itemDocuments) {
    const rewritten = DocumentSchema.parse(rewriteAssetReferences(document, assetIds, entryName));
    documents.push(rewritten);
  }
  for (const { entryName, document } of questionDocuments) {
    const rewritten = rewriteAssetReferences(document, assetIds, entryName);
    if (hooks.importQuestions) await hooks.importQuestions(rewritten, actor);
    else warnings.skippedQuestions.push(entryName.replaceAll('\\', '/'));
  }

  const classified = workspaceFromDocuments(documents);
  if (classified.duplicates.length) {
    throw new ApiError(409, 'DUPLICATE_BUNDLE_DOCUMENT', 'Bundle documents collide or cannot be classified', toValidationIssues(classified.duplicates));
  }
  const split = splitInlineCourse(courseResult.data);
  const items = { ...split.items, ...classified.items };
  // The archive's own bounds are checked in the preflight above; the documents it
  // carries still have to satisfy the same contract as a paste before anything is
  // written, so a bundle cannot be a way around it.
  const { precondition } = await draftPrecondition(courseId, expectedUpdatedAt, deps);
  await assertSaveable(courseId, split.manifest, items, deps, { code: 'INVALID_BUNDLE', message: 'Bundle contents cannot be imported' });
  await replaceDraft(courseId, split.manifest, items, null, deps, precondition);
  return { manifest: split.manifest, items, assets: Object.fromEntries(assetIds), warnings };
}

/**
 * Sources are keyed by `refKey`, not by the legacy document label, so an item whose
 * id is `manifest` gets its own entry (`item:manifest`) instead of overwriting the
 * course document's.
 */
function workspaceOf(draft: CourseDraft): CourseWorkspace {
  return {
    manifest: draft.manifest,
    items: draft.items,
    sources: {
      [sourceKeyOf(COURSE_REF)]: JSON.stringify(draft.manifest, null, 2),
      ...Object.fromEntries(Object.entries(draft.items).map(([id, item]) => [sourceKeyOf(itemRef(id)), JSON.stringify(item, null, 2)])),
    },
  };
}

/**
 * A fresh resolver per call. Repeated references inside one operation cost one
 * lookup; nothing is remembered afterwards, so a later operation cannot be answered
 * from a world that has since changed.
 */
function resolverFor(client: StudioDatabase, deps?: StudioDependencies, courseId?: string): ReferenceResolver {
  return perOperationResolver(deps?.resolver ?? new SupabaseResolver(client as unknown as SupabaseQueryClient, { courseId }));
}

/** Validates the complete stored workspace and attaches per-document source ranges. */
export async function validateDraft(courseId: string, options: { publish: boolean }, deps?: StudioDependencies): Promise<ValidationReport> {
  const client = database(deps);
  const draft = await getDraft(courseId, { ...deps, client });
  // The report is stamped with the revision it describes, so a response that arrives
  // after the editor has moved on can be recognised as stale and dropped.
  return validateWorkspace(workspaceOf(draft), resolverFor(client, deps, courseId), { publish: options.publish, courseId, revision: draft.revision });
}

/** Compiles one item for one preview locale using the publish compiler path. */
export async function previewItem(courseId: string, itemId: string, locale: Locale, deps?: StudioDependencies): Promise<CompiledItem> {
  const client = database(deps);
  const draft = await getDraft(courseId, { ...deps, client });
  const result = await compileCourse(workspaceOf(draft), resolverFor(client, deps, courseId), { locales: [locale] });
  if (!result.ok || !result.compiled) throw new ApiError(422, 'DRAFT_INVALID', 'Draft cannot be previewed', diagnosticIssues(result.report));
  const item = result.compiled.items[itemId];
  if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Draft item not found');
  return item;
}

export type WorkspacePreview = {
  item: CompiledItem | null;
  course: CompiledCourse | null;
  report: ValidationReport;
};

function learnerSafeItem(item: CompiledItem): CompiledItem {
  return {
    ...item,
    grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] },
  };
}

function learnerSafeCourse(course: CompiledCourse): CompiledCourse {
  return {
    ...course,
    items: Object.fromEntries(Object.entries(course.items).map(([id, item]) => [id, learnerSafeItem(item)])),
  };
}

/** Compiles an unsaved workspace without persistence, returning diagnostics instead of failing semantic previews. */
export async function previewWorkspace(
  courseId: string,
  input: unknown,
  includeGrading: boolean,
  deps?: StudioDependencies,
): Promise<WorkspacePreview> {
  const inputResult = WorkspacePreviewInputSchema.safeParse(input);
  if (!inputResult.success) {
    throw new ApiError(422, 'INVALID_WORKSPACE', 'Workspace cannot be previewed', issuesFromZod(inputResult.error));
  }
  const request = inputResult.data;
  const oversized = documentSizeDiagnostics(request.manifest, request.items);
  if (oversized.length) throw new ApiError(413, 'DOCUMENT_TOO_LARGE', 'A content document exceeds the document size limit', toValidationIssues(oversized));
  const identity = assessWorkspace({ manifest: request.manifest, items: request.items }, { courseId, requireComplete: true });
  if (!identity.ok) throw new ApiError(422, 'INVALID_WORKSPACE', 'Workspace cannot be previewed', toValidationIssues(identity.errors));
  const client = database(deps);
  const workspace: CourseWorkspace = { manifest: request.manifest, items: request.items };
  const revision = workspaceRevision(request.manifest, request.items);
  const result = await compileCourse(workspace, resolverFor(client, deps, courseId), { locales: [request.locale] });
  // Keyed by the revision the caller sent: the editor drops a preview whose revision
  // no longer matches the text on screen instead of showing stale content.
  const report: ValidationReport = { ...result.report, revision };
  if (!result.compiled) return { item: null, course: null, report };
  const course = includeGrading ? result.compiled : learnerSafeCourse(result.compiled);
  const selected: DocumentRef = request.selectedRef ?? refFromDocId(request.selectedDocId!);
  if (selected.kind === 'course') return { item: null, course, report };
  return { item: Object.hasOwn(course.items, selected.id) ? course.items[selected.id] : null, course, report };
}

type VersionSnapshot = {
  id: string;
  courseId: string;
  version: number;
  manifest: unknown;
  checksum: string;
  items: Record<string, unknown>;
};

function positiveVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) throw new ApiError(400, 'INVALID_VERSION', 'Version must be a positive integer');
  return version;
}

async function loadVersion(courseId: string, version: number, deps?: StudioDependencies): Promise<VersionSnapshot> {
  const client = database(deps);
  const versionResult = await client.from('course_versions')
    .select('id,course_id,version,manifest,checksum,summary,published_by,published_at,notes')
    .eq('course_id', courseId)
    .eq('version', positiveVersion(version))
    .maybeSingle();
  if (versionResult.error) databaseFailure('Unable to load course version');
  const row = object(versionResult.data);
  const versionId = requiredString(row?.id);
  const checksum = requiredString(row?.checksum);
  if (!row || !versionId || !checksum) throw new ApiError(404, 'VERSION_NOT_FOUND', 'Course version not found');

  const itemsResult = await client.from('course_version_items')
    .select('version_id,item_id,kind,source,checksum')
    .eq('version_id', versionId);
  if (itemsResult.error) databaseFailure('Unable to load course version items');
  const items: Record<string, unknown> = {};
  for (const value of Array.isArray(itemsResult.data) ? itemsResult.data : []) {
    const item = object(value);
    const itemId = requiredString(item?.item_id);
    if (item && itemId) items[itemId] = item.source;
  }
  return {
    id: versionId,
    courseId: requiredString(row.course_id) ?? courseId,
    version: typeof row.version === 'number' ? row.version : version,
    manifest: row.manifest,
    checksum,
    items,
  };
}

/** Returns the immutable source workspace used by a published version. */
export async function getVersionWorkspace(courseId: string, version: number, deps?: StudioDependencies) {
  const snapshot = await loadVersion(courseId, version, deps);
  return { manifest: snapshot.manifest, items: snapshot.items, baseVersionId: snapshot.id };
}

export type PreparedCoursePublication = {
  courseId: string;
  source: { manifest: unknown; items: Record<string, unknown>; baseVersionId: string | null };
  manifest: unknown;
  compiled: Record<string, unknown>;
  checklist: z.infer<typeof PublishChecklistSchema>;
  report: ValidationReport;
  notes: string | null;
  expectedUpdatedAt: string;
  skillDeclarations: ReturnType<typeof declarationsFromCompiledCourse>;
  skillCategory: string;
  checksum: string;
};

/** Performs all fallible course validation and compilation before publication opens its transaction. */
export async function prepareCoursePublication(
  courseId: string,
  input: unknown,
  deps?: StudioDependencies,
  expectedUpdatedAt?: string | null,
): Promise<PreparedCoursePublication> {
  const request = PublishInputSchema.parse(input);
  const client = database(deps);
  const draft = await getDraft(courseId, { ...deps, client });
  const workspace = workspaceOf(draft);
  const resolver = resolverFor(client, deps, courseId);
  // Publication validates the *persisted* revision, and the guarded RPC below
  // refuses if that revision moved between this read and the write.
  const report = await validateWorkspace(workspace, resolver, { publish: true, save: true, courseId, revision: draft.revision });
  assertNoReferenceOutage(report.errors);
  if (!report.ok) throw new ApiError(422, 'COURSE_INVALID', 'Course has validation errors', diagnosticIssues(report));

  const result = await compileCourse(workspace, resolver, { publish: true });
  if (!result.ok || !result.compiled) throw new ApiError(422, 'COURSE_INVALID', 'Course has validation errors', diagnosticIssues(result.report));
  const parsed = parseWorkspace(workspace).parsed;
  if (!parsed) throw new ApiError(422, 'COURSE_INVALID', 'Course workspace cannot be parsed');

  const compiled = {
    ...result.compiled,
    items: Object.fromEntries(Object.entries(result.compiled.items).map(([itemId, item]) => [itemId, {
      ...item,
      source: parsed.items[itemId],
    }])),
  };
  const revision = expectedUpdatedAt || draft.updatedAt;
  if (!revision) throw new ApiError(409, 'DRAFT_CONFLICT', 'Course draft has no persisted revision');
  return {
    courseId,
    source: { manifest: draft.manifest, items: draft.items, baseVersionId: draft.baseVersionId },
    manifest: parsed.manifest,
    compiled,
    checklist: request.checklist,
    report,
    notes: request.notes ?? null,
    expectedUpdatedAt: revision,
    skillDeclarations: declarationsFromCompiledCourse(result.compiled),
    skillCategory: categoryForPathway(result.compiled.meta.pathway),
    checksum: result.compiled.checksum,
  };
}

/** Commits an already prepared immutable course publication in one guarded transaction. */
export async function publishPreparedCourse(prepared: PreparedCoursePublication, actor: Actor, deps?: StudioDependencies) {
  const client = database(deps);
  const auditRow = {
    actor_id: actor.userId,
    action: 'course.publish',
    target_type: 'course',
    target_id: prepared.courseId,
    before: null,
    after: { checksum: prepared.checksum },
  };
  const publishResult = await client.rpc('studio_publish_version_guarded', {
    course_id: prepared.courseId,
    manifest: prepared.manifest,
    compiled: prepared.compiled,
    checklist: prepared.checklist,
    report: prepared.report,
    actor_id: actor.userId,
    notes: prepared.notes,
    audit_row: auditRow,
    expected_updated_at: prepared.expectedUpdatedAt,
    skill_declarations: prepared.skillDeclarations,
    skill_category: prepared.skillCategory,
  });
  if (publishResult.error?.message?.includes('CMS_APPROVED_REVIEW_REQUIRED')) {
    throw new ApiError(409, 'CMS_REVIEW_REQUIRED', 'An approved Central review is required before publication');
  }
  if (publishResult.error) databaseFailure('Unable to publish course version');
  const published = object(publishResult.data);
  if (published?.cms_stale === true) throw new ApiError(409, 'CMS_STALE_REVIEW', 'The approved review no longer matches this draft');
  if (published?.conflict === true) throw new ApiError(409, 'DRAFT_CONFLICT', 'Course draft changed before publishing completed');
  const version = published?.version;
  const checksum = requiredString(published?.checksum) ?? prepared.checksum;
  if (!published || typeof version !== 'number') databaseFailure('Publisher returned an invalid version');

  return { id: requiredString(published.id), version, checksum, report: prepared.report };
}

/** Validates, compiles, and atomically publishes an immutable course version. */
export async function publish(courseId: string, input: unknown, actor: Actor, deps?: StudioDependencies, expectedUpdatedAt?: string | null) {
  const prepared = await prepareCoursePublication(courseId, input, deps, expectedUpdatedAt);
  return publishPreparedCourse(prepared, actor, deps);
}

/** Lists version metadata without loading large immutable item payloads. */
export async function listVersions(courseId: string, deps?: StudioDependencies): Promise<unknown[]> {
  const { data, error } = await database(deps).from('course_versions')
    .select('id,course_id,version,checksum,summary,published_by,published_at,notes')
    .eq('course_id', courseId)
    .order('version', { ascending: false });
  if (error) databaseFailure('Unable to list course versions');
  return Array.isArray(data) ? data : [];
}

/** Replaces the active draft from immutable source snapshots and records its base version. */
export async function restoreAsDraft(courseId: string, version: number, actor: Actor, deps?: StudioDependencies) {
  const client = database(deps);
  const snapshot = await loadVersion(courseId, version, { ...deps, client });
  const { precondition } = await draftPrecondition(courseId, undefined, { ...deps, client });
  const replacement = object(await replaceDraft(courseId, snapshot.manifest, snapshot.items, snapshot.id, { ...deps, client }, precondition));
  const draftId = requiredString(replacement?.draft_id);
  if (!draftId) databaseFailure('Draft replacement returned an invalid draft id');
  try {
    await audit(actor, 'course.restore', { type: 'course', id: courseId }, null, { version: snapshot.version, checksum: snapshot.checksum });
  } catch {
    console.error('Studio audit write failed after commit', {
      action: 'course.restore',
      correlationId: randomUUID(),
      courseId,
    });
  }
  return { draftId, baseVersionId: snapshot.id, version: snapshot.version, checksum: snapshot.checksum };
}

export type ExportFormat = 'bundle' | 'single';
export type VersionExport = {
  format: ExportFormat;
  filename: string;
  contentType: 'application/zip' | 'application/json; charset=utf-8';
  checksum: string;
  body: Uint8Array | string;
};

/** Exports immutable source documents either as the bundle layout or one inline course document. */
export async function exportVersion(courseId: string, version: number, format: ExportFormat, deps?: StudioDependencies): Promise<VersionExport> {
  const snapshot = await loadVersion(courseId, version, deps);
  const parsed = parseWorkspace({ manifest: snapshot.manifest, items: snapshot.items }).parsed;
  if (!parsed) throw new ApiError(500, 'VERSION_INVALID', 'Stored course version is structurally invalid');
  const safeCourseId = courseId.replace(/[^A-Za-z0-9._-]/g, '') || 'course';
  if (format === 'single') {
    return {
      format,
      filename: `${safeCourseId}-v${snapshot.version}.json`,
      contentType: 'application/json; charset=utf-8',
      checksum: snapshot.checksum,
      body: JSON.stringify(inlineWorkspace(parsed), null, 2),
    };
  }

  const zip = new JSZip();
  zip.file('course.json', JSON.stringify(parsed.manifest, null, 2));
  for (const [itemId, item] of Object.entries(parsed.items)) zip.file(`items/${itemId}.json`, JSON.stringify(item, null, 2));
  return {
    format,
    filename: `${safeCourseId}-v${snapshot.version}.zip`,
    contentType: 'application/zip',
    checksum: snapshot.checksum,
    body: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
  };
}

export type ExportWorkspace = ReturnType<typeof inlineWorkspace>;
export { parseWorkspace };

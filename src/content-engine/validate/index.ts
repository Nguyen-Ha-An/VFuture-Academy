import { COURSE_REF, emptySummary, itemRef, makeDiagnostic, refOf, toRef, withRevision, type Diagnostic, type DocumentRef, type ValidationReport, type ValidationSummary } from '../diagnostics';
import { isRenderableBlock } from '../manifest/blocks';
import { resolvePlayer } from '../manifest/players';
import { rubricMaxPoints } from '../schema/questions/base';
import { ACTIVITY_BLOCK_TYPES } from '../schema/activities';
import type { Question } from '../schema/questions';
import { isManualType } from '../schema/questions';
import { parseJsonDocument, pointerToRange } from './parse';
import { assessWorkspace, type WorkspaceAssessment } from './assess';
import { checkStandaloneRendererSupport } from './standalone-renderer';
import { checkIds } from './semantic/ids';
import { checkStructure } from './semantic/structure';
import { checkAnswers, checkQuestion } from './semantic/answers';
import { checkReferences, collectAssetRefs, perOperationResolver, resolveOrReport, type ReferenceResolver } from './semantic/refs';
import { checkQuizQuestions, checkWorkspaceQuizQuestions } from './semantic/quiz-questions';
import { checkL10n } from './semantic/l10n';
import { checkHosts, checkMediaHosts } from './semantic/hosts';
import { checkQuality } from './quality';
import { validateDocument } from './structural';
import { forEachQuestion, itemEntriesOf, walkBlocks } from './walk';
import { workspaceSource, workspaceSourceMap, type CourseWorkspace, type ParsedWorkspace } from './workspace';

export * from './workspace';
export * from './structural';
export * from './parse';
export * from './assess';
export * from './revision';
export { InMemoryResolver, ResolverUnavailableError, perOperationResolver, type ReferenceResolver } from './semantic/refs';
export { checkIds } from './semantic/ids';

export interface ValidateWorkspaceOptions {
  /** Publication gates: renderer support becomes an error. */
  publish?: boolean;
  /** A server write: the same completeness and renderer requirements as publication. */
  save?: boolean;
  /** Course this workspace claims to be; a mismatch is reported, never corrected. */
  courseId?: string;
  /** Source revision the caller validated, echoed back so late reports can be dropped. */
  revision?: string;
}

/**
 * `strict` covers both publication and server writes: a document nothing can render
 * is not something to persist and discover later.
 *
 * The item-level walk is the same `checkStandaloneRendererSupport` a standalone save
 * uses, so a course and a lone document answer the renderer question identically.
 * Without it the workspace pass saw only an item's own block tree and its question
 * player types — a reserved block inside an exam question's stem or an assignment's
 * instructions passed as part of a course while the same bytes were rejected on their
 * own.
 */
export function checkRendererSupport(parsed: ParsedWorkspace, strict: boolean): Diagnostic[] {
  const out: Diagnostic[] = [];
  const severity = strict ? 'error' : 'warning';
  const seen = new Set<string>();
  const add = (diagnostic: Diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.docId}|${diagnostic.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(diagnostic.severity === severity ? diagnostic : { ...diagnostic, severity });
  };
  for (const [docId, doc] of Object.entries(parsed.items)) {
    const ref = itemRef(docId);
    if (doc.kind === 'lesson') walkBlocks(doc.blocks, '/blocks', ({ block, path }) => { if (!isRenderableBlock(block.type)) add(makeDiagnostic('E_RENDERER_UNSUPPORTED', { ref, path, meta: { type: block.type }, severity })); });
    for (const scope of itemEntriesOf(doc)) forEachQuestion(scope.entries, scope.path, ({ question, path }) => { const r = resolvePlayer(question.type, question.display?.interactionType); if (!r.ok) add(makeDiagnostic('E_RENDERER_UNSUPPORTED', { ref, path, meta: { type: `${question.type}:${question.display?.interactionType ?? 'default'}` }, severity })); });
    for (const diagnostic of checkStandaloneRendererSupport(doc, ref)) add(diagnostic);
  }
  return out;
}

export function questionPoints(q: Question): number {
  if (q.type === 'question_group') return q.questions.reduce((s, c) => s + questionPoints(c), 0);
  if (isManualType(q.type) && 'rubric' in q && q.rubric) return q.points ?? rubricMaxPoints(q.rubric);
  return q.points ?? 1;
}

export function summarize(parsed: ParsedWorkspace): ValidationSummary {
  const s = emptySummary();
  s.modules = parsed.manifest.modules.length;
  s.languages = [...parsed.manifest.languages];
  for (const doc of Object.values(parsed.items)) {
    s.items[doc.kind]++;
    if (doc.kind === 'lesson') walkBlocks(doc.blocks, '/blocks', () => { s.blocks++; });
    for (const scope of itemEntriesOf(doc)) forEachQuestion(scope.entries, scope.path, ({ question, parentPath }) => { s.questions[question.type] = (s.questions[question.type] ?? 0) + 1; if (!parentPath) s.totalPoints += questionPoints(question); });
  }
  return s;
}

function attachRanges(ws: CourseWorkspace, ds: Diagnostic[]): Diagnostic[] {
  if (!ws.sources) return ds;
  const parsedSources = new Map<string, ReturnType<typeof parseJsonDocument>>();
  const sourceFor = (key: string, text: string) => {
    const hit = parsedSources.get(key);
    if (hit) return hit;
    const parsed = parseJsonDocument(text, key, { rootType: 'any' });
    parsedSources.set(key, parsed);
    return parsed;
  };
  return ds.map((d) => {
    if (d.range) return d;
    const ref = refOf(d);
    const map = workspaceSourceMap(ws, ref);
    const key = map?.sourceId ?? '';
    const text = map ? ws.sources?.[key] : workspaceSource(ws, ref);
    if (text === undefined) return d;
    const source = sourceFor(map ? key : `ref:${d.docId}`, text);
    const path = map ? `${map.basePath}${d.path}` : d.path;
    const range = pointerToRange(source, path);
    return range ? { ...d, range } : d;
  });
}

function toReport(ws: CourseWorkspace, ds: Diagnostic[], summary: ValidationSummary, revision?: string): ValidationReport {
  const all = withRevision(attachRanges(ws, ds), revision);
  const errors = all.filter((d) => d.severity === 'error'), warnings = all.filter((d) => d.severity !== 'error');
  return { ok: errors.length === 0, errors, warnings, summary, ...(revision ? { revision } : {}) };
}

/**
 * The complete pipeline: strict parse and schema, workspace identity, content
 * semantics, references, renderer support and quality. `save` and `publish` are the
 * strict modes — everything a server write or a publication must satisfy.
 */
export async function validateWorkspace(ws: CourseWorkspace, resolver: ReferenceResolver, opts: ValidateWorkspaceOptions = {}): Promise<ValidationReport> {
  const strict = !!opts.publish || !!opts.save;
  if (ws.parseDiagnostics?.length) return toReport(ws, ws.parseDiagnostics, emptySummary(), opts.revision);

  const assessment = assessWorkspace(ws, { courseId: opts.courseId, requireComplete: strict });
  if (!assessment.parsed) return toReport(ws, assessment.diagnostics, emptySummary(), opts.revision);

  const parsed = assessment.parsed;
  // One resolver instance per operation: repeated references cost one lookup, and
  // the answers cannot go stale because the cache dies with this call.
  const references = perOperationResolver(resolver);
  const ds: Diagnostic[] = [
    ...assessment.diagnostics,
    ...checkStructure(parsed),
    ...checkAnswers(parsed),
    ...(await checkReferences(parsed, references)),
    // Shares the one per-operation resolver above, so a quiz's bank references are
    // looked up once for both the reference pass and the question-type rule.
    ...(await checkWorkspaceQuizQuestions(parsed, references)),
    ...checkL10n(parsed),
    ...checkHosts(parsed),
    ...checkRendererSupport(parsed, strict),
    ...checkQuality(parsed),
  ];
  return toReport(ws, ds, summarize(parsed), opts.revision);
}

/**
 * The gate every content server write goes through. Identity first (cheap, and it
 * explains the most common rejections), then the complete pipeline.
 */
export async function assertSaveableWorkspace(
  ws: CourseWorkspace,
  resolver: ReferenceResolver,
  opts: { courseId?: string; publish?: boolean; revision?: string } = {},
): Promise<{ report: ValidationReport; assessment: WorkspaceAssessment }> {
  const assessment = assessWorkspace(ws, { courseId: opts.courseId, requireComplete: true });
  const report = await validateWorkspace(ws, resolver, { save: true, publish: opts.publish, courseId: opts.courseId, revision: opts.revision });
  return { report, assessment };
}

function resourceActivityDiagnostics(raw: unknown, ref: DocumentRef): Diagnostic[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const document = raw as Record<string, unknown>;
  if (document.kind !== 'resource') return [];
  const activities = new Set<string>(ACTIVITY_BLOCK_TYPES);
  const diagnostics: Diagnostic[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}/${index}`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const block = value as Record<string, unknown>;
    if (typeof block.type === 'string' && activities.has(block.type)) {
      diagnostics.push(makeDiagnostic('E_RESOURCE_ACTIVITY_BLOCK', { ref, path }));
    }
    Object.entries(block).forEach(([key, child]) => visit(child, `${path}/${key}`));
  };
  visit(document.body, '/body');
  return diagnostics;
}

/** Bundles, resources and single item documents outside a course workspace. */
export async function validateStandaloneDocument(raw: unknown, doc: string | DocumentRef, resolver: ReferenceResolver): Promise<{ ok: boolean; doc?: unknown; report: ValidationReport }> {
  const ref = toRef(doc);
  const activityDiagnostics = resourceActivityDiagnostics(raw, ref);
  if (activityDiagnostics.length > 0) {
    return { ok: false, report: { ok: false, errors: activityDiagnostics, warnings: [], summary: emptySummary() } };
  }
  const r = validateDocument(raw, ref);
  if (!r.ok) return { ok: false, report: { ok: false, errors: r.diagnostics, warnings: [], summary: emptySummary() } };
  const references = perOperationResolver(resolver);
  // A document saved on its own gets the same renderer question a workspace document
  // gets. Without this a resource whose body was one reserved block validated clean
  // and persisted, and nothing could draw it.
  const ds: Diagnostic[] = [...checkStandaloneRendererSupport(r.doc, ref), ...checkMediaHosts(ref, r.doc)];
  for (const { id, path } of collectAssetRefs(r.doc)) {
    const asset = await resolveOrReport(ds, { ref, path }, () => references.asset(id));
    if (asset.known && !asset.value) ds.push(makeDiagnostic('E_ASSET_UNKNOWN', { ref, path, meta: { id } }));
  }
  if (r.kind === 'question_bundle') r.doc.questions.forEach((q, i) => ds.push(...checkQuestion(q, `/questions/${i}`, ref)));
  if (r.kind === 'lesson' || r.kind === 'exam') for (const scope of itemEntriesOf(r.doc)) forEachQuestion(scope.entries, scope.path, ({ question, path, parentPath }) => { if (!parentPath) ds.push(...checkQuestion(question, path, ref)); });
  // A lone document gets the same quiz rule a workspace document gets, and here this
  // pass is the only thing that resolves a quiz's bank references.
  if (r.kind === 'lesson' || r.kind === 'exam') ds.push(...await checkQuizQuestions(r.doc, ref, references, { reportUnresolvedRefs: true }));
  const errors = ds.filter((d) => d.severity === 'error'), warnings = ds.filter((d) => d.severity !== 'error');
  return { ok: errors.length === 0, doc: r.doc, report: { ok: errors.length === 0, errors, warnings, summary: emptySummary() } };
}

export { checkStandaloneRendererSupport } from './standalone-renderer';
export { COURSE_REF, itemRef, checkIds as checkWorkspaceIds };

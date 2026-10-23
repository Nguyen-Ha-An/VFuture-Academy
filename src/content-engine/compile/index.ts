import type { Locale, L10nString, MediaRef } from '../schema/common';
import type { CourseAccess, CompletionRule, CourseDocument } from '../schema/course';
import type { Question, PoolDraw } from '../schema/questions';
import { QuestionSchema, bankIdOf, isPoolDraw, isQuestionRef } from '../schema/questions';
import type { Rubric } from '../schema/questions/base';
import type { AssignmentBody, SubmissionSpec } from '../schema/types';
import type { NotebookAssignment } from '../schema/notebook';
import type { Diagnostic, ValidationReport } from '../diagnostics';
import { validateWorkspace, parseWorkspace, type CourseWorkspace, type ItemDocument, type ReferenceResolver } from '../validate';
import { walkBlocks } from '../validate/walk';
import { localizeDeep } from './localize';
import { checksumOf } from './checksum';
import { activitiesOf, lessonCompletionMode, normalizeCompletion, normalizeExamSettings, normalizeQuizSettings, type ActivityDecl, type ExamGradingSettings, type QuizGradingSettings } from './normalize';
import { assertNoAnswerKeys, toGradingQuestion, toLearnerQuestion, type GradingQuestion } from './project';
import { migrateDocument } from './migrate';

export * from './localize';
export * from './normalize';
export * from './project';
export * from './migrate';
export { checksumOf } from './checksum';

export interface PoolSpec { id: string; count: number; pointsEach?: number; from?: string[]; filter?: PoolDraw['$pool']['filter']; sectionId: string }
export interface AssignmentGradingSettings {
  submission: SubmissionSpec;
  notebook?: NotebookAssignment;
  passPoints?: number;
  skills?: string[];
  resubmission: 'until_approved' | 'once' | 'never';
}
export interface GradingItem {
  questions: Record<string, GradingQuestion>;
  quizzes: Record<string, QuizGradingSettings & { questionIds: string[] }>;
  exam?: ExamGradingSettings & { sections: { id: string; questionIds: string[]; pools: PoolSpec[]; timeLimitMinutes?: number }[] };
  rubrics: Record<string, Rubric>;
  assignments?: Record<string, AssignmentGradingSettings>;
  activities: ActivityDecl[];
  lessonCompletionMode?: 'view' | 'activities';
}
export type LearnerItem = Record<string, unknown> & { kind: 'lesson' | 'exam' | 'assignment'; id: string; title: string };
export interface CompiledItem { id: string; kind: 'lesson' | 'exam' | 'assignment'; checksum: string; renders: Record<Locale, LearnerItem>; grading: GradingItem }
export interface CompiledCourse {
  courseId: string; checksum: string; schemaVersion: 1; languages: Locale[]; defaultLanguage: Locale;
  meta: { title: L10nString; summary: L10nString; level: string; difficulty: string; pathway: string; tags: string[]; code?: string; prerequisites?: string[]; estimatedMinutes?: number; cover?: MediaRef; learningOutcomes: L10nString[] };
  access: CourseAccess; enrollment: 'open' | 'invite'; prerequisites: { type: 'course_completion'; courseId: string }[]; skills: { id: string; name: L10nString }[];
  completion: { rules: CompletionRule[]; certificate: boolean };
  outline: { modules: { id: string; title: L10nString; items: { id: string; type: 'lesson' | 'exam' | 'assignment'; title: L10nString; required: boolean; estimatedMinutes?: number }[] }[] };
  items: Record<string, CompiledItem>;
}
export interface CompileOptions { locales?: Locale[]; publish?: boolean }
export interface CompileResult { ok: boolean; diagnostics: Diagnostic[]; report: ValidationReport; compiled?: CompiledCourse }

export const compositeId = (scope: string, id: string) => `${scope}/${id}`;

function assignmentSettings(assignment: AssignmentBody): AssignmentGradingSettings {
  return {
    submission: structuredClone(assignment.submission),
    ...(assignment.notebook ? { notebook: structuredClone(assignment.notebook) } : {}),
    ...(assignment.passPoints !== undefined ? { passPoints: assignment.passPoints } : {}),
    ...(assignment.skills?.length ? { skills: [...assignment.skills] } : {}),
    resubmission: assignment.resubmission ?? 'until_approved',
  };
}

async function resolveEntries(entries: unknown[], scope: string, resolver: ReferenceResolver, grading: GradingItem, pools: PoolSpec[] | null): Promise<unknown[]> {
  const learner: unknown[] = [];
  for (const e of entries) {
    if (isPoolDraw(e)) { const { id, count, pointsEach, from, filter } = e.$pool; pools?.push({ id, count, ...(pointsEach !== undefined ? { pointsEach } : {}), ...(from ? { from } : {}), ...(filter ? { filter } : {}), sectionId: scope }); learner.push({ $pool: { id, count, ...(pointsEach !== undefined ? { pointsEach } : {}) } }); continue; }
    let q: Question, sourceRef: string | undefined;
    if (isQuestionRef(e)) { const snap = await resolver.bankQuestion(bankIdOf(e)); if (!snap) throw new Error(`unresolved ${e.$ref}`); q = QuestionSchema.parse(snap.question); sourceRef = snap.versionId; } else q = e as Question;
    const cid = compositeId(scope, q.id);
    const g = toGradingQuestion(q, cid, undefined, sourceRef);
    grading.questions[cid] = g;
    for (const c of g.children ?? []) grading.questions[c.id] = c;
    learner.push(toLearnerQuestion(q, cid));
  }
  return learner;
}

export async function compileItem(doc: ItemDocument, resolver: ReferenceResolver, locales: Locale[], defaultLanguage: Locale): Promise<CompiledItem> {
  const grading: GradingItem = { questions: {}, quizzes: {}, rubrics: {}, assignments: {}, activities: [] };
  let learnerDoc: Record<string, unknown> = structuredClone(doc) as Record<string, unknown>;
  if (doc.kind === 'lesson') {
    grading.activities = activitiesOf(doc);
    grading.lessonCompletionMode = lessonCompletionMode(doc);
    const replacements = new Map<string, unknown[]>();
    const quizPaths: { path: string; id: string; entries: unknown[]; settings: QuizGradingSettings }[] = [];
    walkBlocks(doc.blocks, '/blocks', ({ block, path }) => {
      if (block.type === 'quiz') quizPaths.push({ path, id: block.id, entries: block.questions, settings: normalizeQuizSettings(block.settings) });
      if (block.type === 'assignment') {
        grading.assignments![block.id] = assignmentSettings(block);
        if (block.rubric) grading.rubrics[block.id] = block.rubric;
      }
    });
    for (const qz of quizPaths) { const learner = await resolveEntries(qz.entries, qz.id, resolver, grading, null); replacements.set(qz.path, learner); grading.quizzes[qz.id] = { ...qz.settings, questionIds: learner.map((l) => (l as { id: string }).id) }; }
    learnerDoc = rewriteQuizzes(learnerDoc, replacements);
  }
  if (doc.kind === 'exam') {
    const settings = normalizeExamSettings(doc.settings);
    const sections: NonNullable<GradingItem['exam']>['sections'] = [];
    const learnerSections = [] as unknown[];
    for (const s of doc.sections) {
      const pools: PoolSpec[] = [];
      const learner = await resolveEntries(s.questions, s.id, resolver, grading, pools);
      sections.push({ id: s.id, questionIds: learner.filter((l) => !isPoolDraw(l)).map((l) => (l as { id: string }).id), pools, ...(s.timeLimitMinutes ? { timeLimitMinutes: s.timeLimitMinutes } : {}) });
      learnerSections.push({ ...s, questions: learner });
    }
    grading.exam = { ...settings, sections };
    learnerDoc = { ...learnerDoc, sections: learnerSections, settings };
  }
  if (doc.kind === 'assignment') {
    grading.assignments![doc.id] = assignmentSettings(doc);
    if (doc.rubric) grading.rubrics[doc.id] = doc.rubric;
  }
  const renders = {} as Record<Locale, LearnerItem>;
  for (const locale of locales) { const r = localizeDeep(learnerDoc, locale, defaultLanguage) as LearnerItem; assertNoAnswerKeys(r); renders[locale] = r; }
  // Bank refs resolve outside the document, so the checksum pins the resolved versions too.
  const bankVersions = [...new Set(Object.values(grading.questions).flatMap((q) => (q.sourceRef ? [q.sourceRef] : [])))].sort();
  return { id: doc.id, kind: doc.kind, checksum: await checksumOf({ doc, bankVersions }), renders, grading };
}

/** Replace `questions` arrays of quiz blocks at the given block paths (pointer → learner entries). */
function rewriteQuizzes(root: Record<string, unknown>, replacements: Map<string, unknown[]>): Record<string, unknown> {
  for (const [path, entries] of replacements) {
    const segs = path.split('/').filter(Boolean);
    let node: unknown = root;
    for (const s of segs) node = (node as Record<string, unknown>)[/^\d+$/.test(s) ? Number(s) : s];
    (node as Record<string, unknown>).questions = entries;
  }
  return root;
}

export async function compileCourse(ws: CourseWorkspace, resolver: ReferenceResolver, opts: CompileOptions = {}): Promise<CompileResult> {
  const migrated = { ...ws, manifest: migrateDocument(ws.manifest), items: Object.fromEntries(Object.entries(ws.items).map(([id, document]) => [id, migrateDocument(document)])) };
  const report = await validateWorkspace(migrated, resolver, { publish: opts.publish });
  if (!report.ok) return { ok: false, diagnostics: [...report.errors, ...report.warnings], report };
  const parsed = parseWorkspace(migrated).parsed!;
  const course: CourseDocument = parsed.manifest;
  const locales = opts.locales ?? course.languages;
  const docs: Record<string, ItemDocument> = parsed.items; // parseWorkspace already split inline items into documents
  const items: Record<string, CompiledItem> = {};
  for (const [id, doc] of Object.entries(docs)) items[id] = await compileItem(doc, resolver, locales, course.defaultLanguage);
  const outline = { modules: course.modules.map((m) => ({ id: m.id, title: m.title, items: m.items.map((it) => ({ id: it.id, type: it.type, title: (docs[it.id]?.title ?? it.title ?? it.id) as L10nString, required: it.required ?? true, ...(('estimatedMinutes' in it && it.estimatedMinutes) || (docs[it.id] as { estimatedMinutes?: number })?.estimatedMinutes ? { estimatedMinutes: (docs[it.id] as { estimatedMinutes?: number })?.estimatedMinutes ?? (it as { estimatedMinutes?: number }).estimatedMinutes } : {}) })) })) };
  const compiled: CompiledCourse = {
    courseId: course.id, checksum: '', schemaVersion: 1, languages: course.languages, defaultLanguage: course.defaultLanguage,
    meta: { title: course.title, summary: course.summary, level: course.level, difficulty: course.difficulty, pathway: course.pathway, tags: course.tags ?? [], ...(course.code ? { code: course.code } : {}), ...(course.prerequisites?.length ? { prerequisites: course.prerequisites.map((prerequisite) => prerequisite.courseId) } : {}), ...(course.estimatedMinutes ? { estimatedMinutes: course.estimatedMinutes } : {}), ...(course.cover ? { cover: course.cover } : {}), learningOutcomes: course.learningOutcomes },
    access: course.access, enrollment: course.enrollment ?? 'open', prerequisites: course.prerequisites ?? [], skills: course.skills ?? [], completion: normalizeCompletion(course), outline, items,
  };
  compiled.checksum = await checksumOf({ manifest: course, items: Object.values(items).map((i) => i.checksum) });
  return { ok: true, diagnostics: report.warnings, report, compiled };
}

export async function compileBankQuestion(q: Question, locales: Locale[], defaultLanguage: Locale = locales[0]): Promise<{ renders: Record<Locale, Record<string, unknown>>; grading: GradingQuestion }> {
  const renders = {} as Record<Locale, Record<string, unknown>>;
  for (const locale of locales) { const r = localizeDeep(toLearnerQuestion(q), locale, defaultLanguage) as Record<string, unknown>; assertNoAnswerKeys(r); renders[locale] = r; }
  return { renders, grading: toGradingQuestion(q) };
}

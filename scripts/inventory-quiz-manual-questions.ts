import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { isManualType } from '../src/content-engine/schema/questions';
import { createServiceClient } from '../src/lib/supabase/service-client';
import { loadEnvironment } from './load-env';

/**
 * Read-only inventory of published quizzes that hold a manually graded question.
 *
 * A quiz has no manual-grading workflow, so such a question blocks every learner who
 * reaches it at submit. Authoring now rejects the shape (`E_QUIZ_MANUAL_QUESTION`),
 * which says nothing about the versions already published — this reports the blast
 * radius of what is already out there, and separates course versions that are still
 * current from historical ones.
 *
 * The output is deliberately narrow: course, version, item, quiz and question ids plus
 * the question type and counts. Answer keys, question text, learner answers and every
 * other personal or secret value stay in memory and are never written anywhere. The
 * database is only read — no insert, update, delete or RPC — and no credential is
 * echoed, not even truncated.
 *
 * A **live** run writes its per-question detail to `--out` and prints counts only, and
 * that path must be a git-ignored local artifact (`recovery-evidence/`, or anywhere
 * outside the repository). Offline runs over fixture input print freely.
 */

/** One `course_version_items` row, reduced to what the scan needs. */
export interface GradingSnapshotRow {
  version_id: string;
  item_id: string;
  grading: unknown;
  /** Owning course, when the caller could resolve it. */
  course_id?: string;
  /** Version number within that course, when the caller could resolve it. */
  version?: number;
  /** True when this version is the course's current one; omitted when unknown. */
  active?: boolean;
}

export interface ManualQuizQuestion {
  versionId: string;
  itemId: string;
  quizId: string;
  /** Composite question id as stored in the grading snapshot. */
  questionId: string;
  type: string;
  courseId?: string;
  version?: number;
  active?: boolean;
}

export interface InventorySummary {
  rowsScanned: number;
  questions: number;
  versionsAffected: number;
  itemsAffected: number;
  quizzesAffected: number;
  /** Versions a learner can still reach today. */
  activeVersionsAffected: number;
  /** Versions superseded by a newer publication; old attempts keep their records. */
  historicalVersionsAffected: number;
  /** Versions whose current/historical standing could not be established. */
  unknownVersionsAffected: number;
  byType: Record<string, number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Walks one grading question and its group children. `selfAssessment` questions are
 * excluded by design: they are unscored reflections and grading returns
 * `self_assessed`, never `pending_manual`, so they never block a submission. Every
 * other question type is left exactly as it is.
 */
function collectManual(
  node: unknown,
  id: string,
  depth: number,
  seen: Set<string>,
  out: { questionId: string; type: string }[],
): void {
  if (depth > 8 || seen.has(id) || !isRecord(node)) return;
  seen.add(id);
  const children = node.children;
  if (Array.isArray(children)) {
    // A group is never manual itself; its leaves decide. Children are stored inline in
    // the snapshot as well as under their own composite id.
    for (const child of children) {
      if (isRecord(child) && typeof child.id === 'string') collectManual(child, child.id, depth + 1, seen, out);
    }
    return;
  }
  if (typeof node.type !== 'string' || !isManualType(node.type)) return;
  if (node.selfAssessment === true) return;
  out.push({ questionId: id, type: node.type });
}

/** Every manual, non-self-assessed quiz question in the given grading snapshots. */
export function findManualQuizQuestions(rows: readonly GradingSnapshotRow[]): ManualQuizQuestion[] {
  const out: ManualQuizQuestion[] = [];
  for (const row of rows) {
    if (!isRecord(row.grading)) continue;
    const questions = isRecord(row.grading.questions) ? row.grading.questions : {};
    const quizzes = isRecord(row.grading.quizzes) ? row.grading.quizzes : {};
    const origin = {
      ...(row.course_id === undefined ? {} : { courseId: row.course_id }),
      ...(row.version === undefined ? {} : { version: row.version }),
      ...(row.active === undefined ? {} : { active: row.active }),
    };
    for (const [quizId, quiz] of Object.entries(quizzes)) {
      if (!isRecord(quiz) || !Array.isArray(quiz.questionIds)) continue;
      for (const questionId of quiz.questionIds) {
        if (typeof questionId !== 'string') continue;
        const found: { questionId: string; type: string }[] = [];
        collectManual(questions[questionId], questionId, 0, new Set(), found);
        for (const leaf of found) out.push({ versionId: row.version_id, itemId: row.item_id, quizId, ...leaf, ...origin });
      }
    }
  }
  return out;
}

export function summarize(rowsScanned: number, found: readonly ManualQuizQuestion[]): InventorySummary {
  const byType: Record<string, number> = {};
  for (const entry of found) byType[entry.type] = (byType[entry.type] ?? 0) + 1;
  const versions = new Map<string, boolean | undefined>();
  for (const entry of found) if (!versions.has(entry.versionId)) versions.set(entry.versionId, entry.active);
  const standing = [...versions.values()];
  return {
    rowsScanned,
    questions: found.length,
    versionsAffected: versions.size,
    itemsAffected: new Set(found.map((e) => `${e.versionId}/${e.itemId}`)).size,
    quizzesAffected: new Set(found.map((e) => `${e.versionId}/${e.itemId}/${e.quizId}`)).size,
    activeVersionsAffected: standing.filter((a) => a === true).length,
    historicalVersionsAffected: standing.filter((a) => a === false).length,
    unknownVersionsAffected: standing.filter((a) => a === undefined).length,
    byType,
  };
}

const rowSchema = z.object({
  version_id: z.string().min(1),
  item_id: z.string().min(1),
  grading: z.unknown(),
  course_id: z.string().min(1).optional(),
  version: z.number().int().optional(),
  active: z.boolean().optional(),
});
const inputSchema = z.union([
  z.array(rowSchema),
  z.object({ rows: z.array(rowSchema) }).transform((value) => value.rows),
]);

/** Offline input: a JSON array of rows, or `{ "rows": [...] }`. */
export function readOfflineRows(path: string): GradingSnapshotRow[] {
  return inputSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) as GradingSnapshotRow[];
}

/**
 * Live findings name real published course versions, so they belong in a local
 * artifact git never tracks — `recovery-evidence/`, or any path outside the repository.
 * Returns the resolved path, or throws with the rule spelled out.
 */
export function resolveEvidencePath(out: string, repoRoot: string): string {
  const path = isAbsolute(out) ? resolve(out) : resolve(repoRoot, out);
  const inside = relative(resolve(repoRoot), path);
  const escapes = inside.startsWith('..') || isAbsolute(inside);
  if (escapes) return path;
  const [head] = inside.split(/[\\/]/);
  if (head === 'recovery-evidence') return path;
  throw new Error(`--out must be a git-ignored local artifact: use recovery-evidence/<file>.json or a path outside the repository (received "${out}").`);
}

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const PAGE_SIZE = 500;

/* v8 ignore start -- operator-only live read; the scan, the summary and the output rule are covered offline. */
type ServiceClient = ReturnType<typeof createServiceClient>;

async function readAllPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await read(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Unable to read ${what}`, { cause: error });
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function liveClient(): ServiceClient {
  loadEnvironment();
  const environment = environmentSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!environment.success) {
    // Names only: never echo a credential, not even a truncated one. The run stops
    // here rather than reporting an empty inventory as if it had covered anything.
    const names = [...new Set(environment.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Live inventory needs ${names}. No inventory was taken. Set them, or run offline with --input <rows.json>.`);
  }
  return createServiceClient(environment.data.NEXT_PUBLIC_SUPABASE_URL, environment.data.SUPABASE_SERVICE_ROLE_KEY);
}

async function readLiveRows(service: ServiceClient): Promise<{ rows: GradingSnapshotRow[]; standingKnown: boolean }> {
  const items = await readAllPages<{ version_id: string; item_id: string; grading: unknown }>(
    (from, to) => service.from('course_version_items').select('version_id,item_id,grading').eq('kind', 'lesson').order('version_id', { ascending: true }).order('item_id', { ascending: true }).range(from, to),
    'course_version_items',
  );
  let versions = new Map<string, { courseId: string; version: number }>();
  let current = new Set<string>();
  let standingKnown = true;
  try {
    const versionRows = await readAllPages<{ id: string; course_id: string; version: number }>(
      (from, to) => service.from('course_versions').select('id,course_id,version').order('id', { ascending: true }).range(from, to),
      'course_versions',
    );
    versions = new Map(versionRows.map((v) => [v.id, { courseId: v.course_id, version: v.version }]));
    const courseRows = await readAllPages<{ current_version_id: string | null }>(
      (from, to) => service.from('courses').select('current_version_id').order('id', { ascending: true }).range(from, to),
      'courses',
    );
    current = new Set(courseRows.map((c) => c.current_version_id).filter((id): id is string => typeof id === 'string'));
  } catch (error) {
    // Say the standing is unknown rather than mislabel every version as historical.
    console.error('Could not establish which versions are current:', error instanceof Error ? error.message : error);
    standingKnown = false;
  }
  return {
    standingKnown,
    rows: items.map((item) => {
      const meta = versions.get(item.version_id);
      return {
        ...item,
        ...(meta ? { course_id: meta.courseId, version: meta.version } : {}),
        ...(standingKnown ? { active: current.has(item.version_id) } : {}),
      };
    }),
  };
}

function printSummary(summary: InventorySummary, source: string, standingKnown: boolean) {
  console.log(`Scanned ${summary.rowsScanned} lesson grading snapshot(s) from ${source} — read-only, nothing was written.`);
  console.log(`Manual quiz questions: ${summary.questions} across ${summary.quizzesAffected} quiz(zes), ${summary.itemsAffected} item(s), ${summary.versionsAffected} version(s).`);
  console.log(standingKnown
    ? `  current versions: ${summary.activeVersionsAffected} · historical versions: ${summary.historicalVersionsAffected}`
    : `  current vs historical: unknown for ${summary.unknownVersionsAffected} version(s); the standing lookup was unavailable.`);
  for (const [type, count] of Object.entries(summary.byType).sort()) console.log(`  ${type}: ${count}`);
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const repoRoot = resolve(import.meta.dirname, '..');
  const live = !values.input;
  if (live && !values.out) {
    throw new Error('A live inventory names published course versions: pass --out recovery-evidence/<file>.json (git-ignored) for the per-question detail. Counts are printed to stdout.');
  }
  const destination = values.out ? resolveEvidencePath(values.out, repoRoot) : undefined;

  const { rows, standingKnown } = await (async () => {
    if (live) return readLiveRows(liveClient());
    const offline = readOfflineRows(values.input!);
    return { rows: offline, standingKnown: offline.some((row) => row.active !== undefined) };
  })();
  const found = findManualQuizQuestions(rows);
  const summary = summarize(rows.length, found);

  if (destination) {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify({ summary, questions: found }, null, 2)}\n`, 'utf8');
  }
  if (values.json && !live) {
    console.log(JSON.stringify({ summary, questions: found }, null, 2));
    return;
  }
  printSummary(summary, live ? 'the live database' : values.input!, standingKnown);
  if (destination) console.log(`Per-question detail written to ${destination}.`);
  // Live detail stays in the ignored artifact; offline input is fixture data.
  else for (const entry of found) console.log(`  ${entry.courseId ?? '-'} ${entry.versionId} ${entry.itemId} ${entry.quizId} ${entry.questionId} (${entry.type})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('Quiz manual-question inventory failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */

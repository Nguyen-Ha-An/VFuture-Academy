import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { compileCourse } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import {
  findManualQuizQuestions,
  readOfflineRows,
  resolveEvidencePath,
  summarize,
  type GradingSnapshotRow,
} from '../../scripts/inventory-quiz-manual-questions';

const repoRoot = resolve(__dirname, '../..');
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const script = 'scripts/inventory-quiz-manual-questions.ts';
const run = (args: string[], env: Record<string, string> = {}) => spawnSync(
  process.execPath,
  [tsx, script, ...args],
  { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } },
);

const question = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'essay', points: 3, settings: {}, interactionType: 'textarea', selfAssessment: false, ...extra,
});
const row = (versionId: string, itemId: string, questions: Record<string, unknown>, questionIds: string[]): GradingSnapshotRow => ({
  version_id: versionId,
  item_id: itemId,
  grading: { questions, quizzes: { 'quiz-1': { questionIds } }, rubrics: {}, activities: [] },
});

const writeRows = (rows: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), 'quiz-inventory-')), 'rows.json');
  writeFileSync(path, JSON.stringify(rows), 'utf8');
  return path;
};

describe('quiz manual-question inventory scan', () => {
  it('reports a manually graded quiz question with its version, item, quiz and question ids', () => {
    const rows = [row('v1', 'lesson-1', { 'quiz-1/q1': question('quiz-1/q1') }, ['quiz-1/q1'])];
    expect(findManualQuizQuestions(rows)).toEqual([
      { versionId: 'v1', itemId: 'lesson-1', quizId: 'quiz-1', questionId: 'quiz-1/q1', type: 'essay' },
    ]);
  });

  it('excludes self-assessment reflections and automatically graded questions', () => {
    const rows = [row('v1', 'lesson-1', {
      'quiz-1/reflect': question('quiz-1/reflect', { selfAssessment: true, points: 0 }),
      'quiz-1/auto': { id: 'quiz-1/auto', type: 'short_answer', points: 1, settings: {}, selfAssessment: false },
    }, ['quiz-1/reflect', 'quiz-1/auto'])];
    expect(findManualQuizQuestions(rows)).toEqual([]);
  });

  it('reaches a manual leaf nested inside a question group', () => {
    const child = question('quiz-1/g1/c2');
    const group = { id: 'quiz-1/g1', type: 'question_group', points: 3, settings: {}, selfAssessment: false, children: [{ id: 'quiz-1/g1/c1', type: 'true_false', points: 1, settings: {}, selfAssessment: false }, child] };
    const rows = [row('v1', 'lesson-1', { 'quiz-1/g1': group, 'quiz-1/g1/c1': group.children[0], 'quiz-1/g1/c2': child }, ['quiz-1/g1'])];
    expect(findManualQuizQuestions(rows)).toEqual([
      { versionId: 'v1', itemId: 'lesson-1', quizId: 'quiz-1', questionId: 'quiz-1/g1/c2', type: 'essay' },
    ]);
  });

  it('ignores exam and assignment grading, which own the manual workflow', () => {
    const rows: GradingSnapshotRow[] = [{
      version_id: 'v1', item_id: 'exam-1',
      grading: { questions: { 'e1': question('e1') }, quizzes: {}, exam: { sections: [{ id: 's1', questionIds: ['e1'], pools: [] }] }, rubrics: {}, activities: [] },
    }];
    expect(findManualQuizQuestions(rows)).toEqual([]);
  });

  it('tolerates a snapshot whose shape it does not recognise', () => {
    expect(findManualQuizQuestions([
      { version_id: 'v1', item_id: 'a', grading: null },
      { version_id: 'v1', item_id: 'b', grading: { quizzes: { q: { questionIds: ['missing'] } } } },
    ])).toEqual([]);
  });

  it('counts distinct versions, items and quizzes', () => {
    const rows = [
      row('v1', 'lesson-1', { 'quiz-1/q1': question('quiz-1/q1'), 'quiz-1/q2': question('quiz-1/q2', { type: 'code_answer' }) }, ['quiz-1/q1', 'quiz-1/q2']),
      row('v2', 'lesson-1', { 'quiz-1/q1': question('quiz-1/q1') }, ['quiz-1/q1']),
    ];
    expect(summarize(rows.length, findManualQuizQuestions(rows))).toEqual({
      rowsScanned: 2, versionsAffected: 2, itemsAffected: 2, quizzesAffected: 2, questions: 3,
      activeVersionsAffected: 0, historicalVersionsAffected: 0, unknownVersionsAffected: 2,
      byType: { essay: 2, code_answer: 1 },
    });
  });

  it('separates course versions that are still current from historical ones', () => {
    const rows = [
      { ...row('v-current', 'lesson-1', { 'quiz-1/q1': question('quiz-1/q1') }, ['quiz-1/q1']), course_id: 'ai', version: 4, active: true },
      { ...row('v-old', 'lesson-1', { 'quiz-1/q1': question('quiz-1/q1') }, ['quiz-1/q1']), course_id: 'ai', version: 3, active: false },
    ];
    const found = findManualQuizQuestions(rows);
    expect(found).toMatchObject([
      { versionId: 'v-current', courseId: 'ai', version: 4, active: true },
      { versionId: 'v-old', courseId: 'ai', version: 3, active: false },
    ]);
    expect(summarize(rows.length, found)).toMatchObject({
      activeVersionsAffected: 1, historicalVersionsAffected: 1, unknownVersionsAffected: 0,
    });
  });

  it('finds nothing in the demo courses, whose quiz reflections are self-assessed', async () => {
    const compiled = await compileCourse(FIXTURES['all-question-types'], fixtureResolver, { publish: true });
    const rows = Object.values(compiled.compiled!.items).map((item) => ({ version_id: 'fixture', item_id: item.id, grading: item.grading }));
    expect(findManualQuizQuestions(rows)).toEqual([]);
  });
});

describe('quiz manual-question inventory CLI', { timeout: 30_000 }, () => {
  it('reads rows from an offline file and never prints an answer key', () => {
    const path = writeRows([{
      version_id: 'v1', item_id: 'lesson-1',
      grading: {
        questions: { 'quiz-1/q1': question('quiz-1/q1', { sampleAnswer: 'SECRET-SAMPLE', correctAnswer: ['SECRET-KEY'] }) },
        quizzes: { 'quiz-1': { questionIds: ['quiz-1/q1'] } },
      },
    }]);
    const result = run(['--input', path]);
    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain('v1 lesson-1 quiz-1 quiz-1/q1 (essay)');
    expect(result.stdout).toContain('Manual quiz questions: 1');
    expect(result.stdout).not.toContain('SECRET-KEY');
    expect(result.stdout).not.toContain('SECRET-SAMPLE');
  });

  it('emits ids and counts only in JSON mode', () => {
    const path = writeRows({ rows: [{ version_id: 'v1', item_id: 'lesson-1', grading: { questions: { 'quiz-1/q1': question('quiz-1/q1', { correctAnswer: ['SECRET-KEY'] }) }, quizzes: { 'quiz-1': { questionIds: ['quiz-1/q1'] } } } }] });
    const result = run(['--input', path, '--json']);
    expect(result.status ?? 0).toBe(0);
    const payload = JSON.parse(result.stdout) as { summary: Record<string, unknown>; questions: Record<string, unknown>[] };
    expect(payload.summary).toMatchObject({ rowsScanned: 1, questions: 1 });
    expect(Object.keys(payload.questions[0]).sort()).toEqual(['itemId', 'questionId', 'quizId', 'type', 'versionId']);
    expect(result.stdout).not.toContain('SECRET-KEY');
  });

  it('says plainly when live credentials are unavailable, and claims no coverage', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'quiz-inventory-out-')), 'evidence.json');
    const result = run(['--out', out], { NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Live inventory needs');
    expect(result.stderr).toContain('No inventory was taken');
    expect(result.stdout).not.toContain('Manual quiz questions:');
  });

  it('refuses a live run that would print published version ids to the terminal', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('recovery-evidence');
    expect(result.stdout).toBe('');
  });

  it('writes detail to a git-ignored artifact and prints counts only', () => {
    const path = writeRows([{ version_id: 'v1', item_id: 'lesson-1', active: true, course_id: 'ai', version: 2, grading: { questions: { 'quiz-1/q1': question('quiz-1/q1') }, quizzes: { 'quiz-1': { questionIds: ['quiz-1/q1'] } } } }]);
    const out = join(mkdtempSync(join(tmpdir(), 'quiz-inventory-out-')), 'evidence.json');
    const result = run(['--input', path, '--out', out]);
    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain('current versions: 1 · historical versions: 0');
    expect(result.stdout).toContain(`Per-question detail written to ${out}`);
    expect(result.stdout).not.toContain('quiz-1/q1');
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      summary: { activeVersionsAffected: 1 },
      questions: [{ versionId: 'v1', courseId: 'ai', version: 2, questionId: 'quiz-1/q1', active: true }],
    });
  });

  it('rejects an offline file that is not a row list', () => {
    expect(run(['--input', writeRows({ nope: true })]).status).toBe(1);
  });
});

describe('offline row reader', () => {
  it('accepts a bare array and a { rows } envelope alike', () => {
    const rows = [{ version_id: 'v1', item_id: 'i1', grading: {} }];
    expect(readOfflineRows(writeRows(rows))).toEqual(rows);
    expect(readOfflineRows(writeRows({ rows }))).toEqual(rows);
  });
});

describe('live output containment', () => {
  it('accepts recovery-evidence and paths outside the repository, and refuses tracked ones', () => {
    expect(resolveEvidencePath('recovery-evidence/quiz.json', repoRoot)).toBe(join(repoRoot, 'recovery-evidence', 'quiz.json'));
    expect(resolveEvidencePath(join(tmpdir(), 'quiz.json'), repoRoot)).toBe(join(tmpdir(), 'quiz.json'));
    expect(() => resolveEvidencePath('docs/quiz-inventory.json', repoRoot)).toThrow(/git-ignored/);
    expect(() => resolveEvidencePath('quiz.json', repoRoot)).toThrow(/recovery-evidence/);
  });
});

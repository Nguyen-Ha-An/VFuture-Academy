import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ValidationReport } from '@/content-engine/diagnostics';
import { expectedInlineRanges, expectedWrapperRange, inlineRangeSource, wrapperRangeSource } from './workspace-range-fixtures';

const repoRoot = resolve(__dirname, '../..');
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const fixtures = join(repoRoot, 'src', 'content-engine', 'fixtures', 'ai-foundations');
const minimal = join(repoRoot, 'src', 'content-engine', 'fixtures', 'minimal');
const run = (script: string, args: string[]) => spawnSync(process.execPath, [tsx, script, ...args], { cwd: repoRoot, encoding: 'utf8' });

describe('content:compile CLI', { timeout: 15_000 }, () => {
  it('rejects unsupported locales', () => {
    const result = run('scripts/content-compile.ts', [fixtures, '--fixtures', '--locales', 'fr', '--out', mkdtempSync(join(tmpdir(), 'compile-'))]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unsupported locale: fr');
  });

  it('replaces stale artifacts when a forced recompile has fewer locales', () => {
    const out = mkdtempSync(join(tmpdir(), 'compile-stale-'));
    expect(run('scripts/content-compile.ts', [fixtures, '--fixtures', '--out', out]).status).toBe(0);
    expect(existsSync(join(out, 'renders', 'what-is-ai.en.json'))).toBe(true);
    expect(run('scripts/content-compile.ts', [fixtures, '--fixtures', '--locales', 'vi', '--out', out, '--force']).status).toBe(0);
    expect(readdirSync(join(out, 'renders')).every((file) => file.endsWith('.vi.json'))).toBe(true);
    expect(existsSync(join(out, 'renders', 'what-is-ai.en.json'))).toBe(false);
  });

  it('rejects a non-empty output and removes stale items on forced recompilation', () => {
    const out = mkdtempSync(join(tmpdir(), 'compile-items-'));
    expect(run('scripts/content-compile.ts', [fixtures, '--fixtures', '--out', out]).status).toBe(0);
    expect(run('scripts/content-compile.ts', [minimal, '--fixtures', '--out', out]).status).toBe(2);
    expect(run('scripts/content-compile.ts', [minimal, '--fixtures', '--out', out, '--force']).status).toBe(0);
    expect(existsSync(join(out, 'grading', 'exam-m1.json'))).toBe(false);
    expect(readdirSync(join(out, 'grading'))).toEqual(['hello.json', 'intro.json']);
  });
});

describe('content:validate CLI', { timeout: 15_000 }, () => {
  it('rejects unsupported --lang values', () => {
    const result = run('scripts/content-validate.ts', [fixtures, '--fixtures', '--lang', 'fr']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unsupported locale: fr');
  });

  it('reports malformed directory JSON with its real parse location', () => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-malformed-'));
    mkdirSync(join(dir, 'items'));
    writeFileSync(join(dir, 'course.json'), '{\n  "kind":\n}');
    const result = run('scripts/content-validate.ts', [dir, '--publish']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('E_JSON_PARSE manifest');
    expect(result.stdout).toContain('(line 3:1)');
  });

  it('rejects an oversized document inside a workspace envelope before structural validation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-oversize-'));
    const file = join(dir, 'workspace.json');
    writeFileSync(file, JSON.stringify({ manifest: { schemaVersion: 1, kind: 'course' }, items: { intro: { schemaVersion: 1, kind: 'lesson', id: 'intro', padding: 'x'.repeat(1_100_000) } } }));
    const result = run('scripts/content-validate.ts', [file, '--publish']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('E_LIMIT_EXCEEDED intro');
    expect(result.stdout).toContain('bytes');
  });

  it('rejects a single course document over the document limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-oversize-doc-'));
    const file = join(dir, 'course.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: 'course', id: 'big', padding: 'x'.repeat(1_100_000) }));
    const result = run('scripts/content-validate.ts', [file, '--publish']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('E_LIMIT_EXCEEDED manifest');
  });

  it('does not pretend unresolved references exist without --refs or --fixtures', () => {
    const result = run('scripts/content-validate.ts', [fixtures]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/E_ASSET_UNKNOWN|E_REF_UNRESOLVED|E_RESOURCE_UNKNOWN|E_OPPORTUNITY_UNKNOWN/);
  });

  it('returns wrapper and inline item ranges from the submitted files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-ranges-'));
    const cases = [
      { name: 'wrapper', source: wrapperRangeSource, expected: { 'wrapper-item': expectedWrapperRange } },
      { name: 'inline', source: inlineRangeSource, expected: expectedInlineRanges },
    ];
    for (const testCase of cases) {
      const file = join(dir, `${testCase.name}.json`);
      writeFileSync(file, testCase.source);
      const result = run('scripts/content-validate.ts', [file, '--json']);
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout) as ValidationReport;
      for (const [docId, range] of Object.entries(testCase.expected)) {
        expect(report.errors.find((error) => error.docId === docId)?.range).toEqual(range);
      }
    }
  });
});

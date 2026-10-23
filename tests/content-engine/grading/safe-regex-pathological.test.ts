import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { SAFE_REGEX_LIMITS } from '@/content-engine/grading/safe-regex';

const repoRoot = resolve(__dirname, '../../..');
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const probe = join('tests', 'content-engine', 'grading', 'pathological-regex-probe.ts');

/**
 * A backtracking engine would spin synchronously inside the probe, and a synchronous loop
 * cannot be interrupted by an in-process test timeout. So the probe runs as a child process
 * that the parent kills outright, making the bound a real one.
 */
const HARD_KILL_MS = 20_000;

interface ProbeCase { pattern: string; expected: boolean; compiled: boolean; matched: boolean | null }
interface ProbeReport { elapsedMs: number; inputLength: number; results: ProbeCase[] }

describe('pathological regex patterns', { timeout: 90_000 }, () => {
  it('matches catastrophic-backtracking patterns in linear time, under a hard process kill', () => {
    const run = spawnSync(process.execPath, [tsx, probe], { cwd: repoRoot, encoding: 'utf8', timeout: HARD_KILL_MS, killSignal: 'SIGKILL' });

    expect(run.signal, `probe was killed after ${HARD_KILL_MS}ms: matching did not run in linear time`).toBeNull();
    expect(run.status, run.stderr).toBe(0);

    const report = JSON.parse(run.stdout) as ProbeReport;
    expect(report.inputLength).toBe(SAFE_REGEX_LIMITS.inputChars);
    expect(report.results.length).toBeGreaterThanOrEqual(5);
    for (const c of report.results) {
      expect(c.compiled, c.pattern).toBe(true);
      expect(c.matched, c.pattern).toBe(c.expected);
    }
    // Startup is excluded: the probe times matching only.
    expect(report.elapsedMs).toBeLessThan(1_000);
  });
});

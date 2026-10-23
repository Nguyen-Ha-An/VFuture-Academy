import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/verify-security-catalog-quiz.mjs', import.meta.url));

describe('catalog account RLS and persisted quiz feedback boundaries', () => {
  it('executes the forward migration and adversarial queries in PostgreSQL', () => {
    // PGLITE_MODULE_PATH can share a preinstalled runtime with other SQL checks.
    // Otherwise the existing harness installs a pinned, isolated temporary runtime.
    const output = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      env: process.env,
      timeout: 120_000,
    });
    expect(output).toContain('PASS: catalog RLS');
  }, 125_000);
});

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('certificate CLI runtime', () => {
  it('renders a real PDF through the CommonJS seed entry without mocking the renderer', () => {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--tsconfig',
      join(process.cwd(), 'scripts', 'tsconfig.seed.json'),
      join(process.cwd(), 'tests', 'scripts', 'fixtures', 'render-certificate.ts'),
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    });

    const errorCode = /ERR_[A-Z_]+/.exec(result.stderr)?.[0] ?? null;
    expect({ status: result.status, errorCode }).toEqual({ status: 0, errorCode: null });
    const evidence = JSON.parse(result.stdout.trim()) as {
      bytes: number;
      header: string;
      trailer: string;
    };
    expect(evidence).toEqual({
      bytes: expect.any(Number),
      header: '%PDF-',
      trailer: '%%EOF',
    });
    expect(evidence.bytes).toBeGreaterThan(1_000);
  }, 35_000);
});

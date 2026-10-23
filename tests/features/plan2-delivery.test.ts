import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playwrightTarget } from '../../scripts/lib/playwright-target';

function source(path: string): string {
  return readFileSync(join(process.cwd(), ...path.split('/')), 'utf8');
}

describe('Academy local delivery wiring', () => {
  it('exposes the idempotent development seed command', () => {
    const pkg = JSON.parse(source('package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.['seed:dev']).toBe('tsx --tsconfig scripts/tsconfig.seed.json scripts/seed-dev.ts');
  });

  it('uses NEXT_PUBLIC_APP_URL for Playwright and keeps E2E specs out of Vitest', () => {
    expect(source('playwright.config.ts')).toContain('playwrightTarget(process.env)');
    expect(playwrightTarget({ PLAYWRIGHT_TARGET: 'remote', NEXT_PUBLIC_APP_URL: 'https://staging.example.test' })).toEqual({ baseURL: 'https://staging.example.test' });
    expect(source('vitest.config.mts')).toContain("exclude: ['tests/e2e/**'");
  });

  it('contains the disposable-admin B11 authoring journey', () => {
    const path = join(process.cwd(), 'tests', 'e2e', 'studio-publish.spec.ts');
    expect(existsSync(path)).toBe(true);
    const spec = existsSync(path) ? readFileSync(path, 'utf8') : '';
    for (const marker of [
      "./support/auth",
      './support/studio-import-fixture',
      'withDisposableStudioImport',
      "openRolePage(browser, 'admin'",
      '@main-unique disposable Studio import and publication',
      'Import course content',
      'Showing the last valid preview.',
      'Save draft',
      '/draft/workspace',
      "headers()['if-match']",
      // Publication goes through review now (PublishDialog was removed): approve and publish with the checklist.
      'Approve and publish',
      '/approve-and-publish',
      'Version 1',
      'Export bundle',
    ]) expect(spec, marker).toContain(marker);
  });

  it('requires local verification and deploys without database or fixture secrets', () => {
    const workflow = source('.github/workflows/deploy.yaml');
    expect(workflow).toContain('vercel deploy --yes --prod');
    expect(workflow).not.toMatch(/SUPABASE_|SEED_|playwright|npm run (?:migrate|test|lint|typecheck)/);
    const local = source('scripts/verify-local.mjs');
    expect(local).toContain('graphify:check');
    expect(local).toContain('playwright');
    expect(local).toContain('fixtures/studio-assets-sql.mjs');
  });
});

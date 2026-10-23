import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load(source: string): {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; needs?: unknown; steps: { run?: string; uses?: string; with?: Record<string, string> }[] }>;
} };
const source = readFileSync('.github/workflows/deploy.yaml', 'utf8');
const workflow = yaml.load(source);

describe('deployment-only GitHub Actions policy', () => {
  it('has exactly one workflow and one deployment job', () => {
    expect(readdirSync('.github/workflows').filter(name => /\.ya?ml$/.test(name))).toEqual(['deploy.yaml']);
    expect(Object.keys(workflow.jobs)).toEqual(['deploy']);
    expect(workflow.jobs.deploy.needs).toBeUndefined();
  });
  it('deploys main pushes and explicit main dispatches without a CI prerequisite', () => {
    expect(workflow.on).toEqual({ push: { branches: ['main'] }, workflow_dispatch: null });
    const permits = new Function('github', `return (${workflow.jobs.deploy.if});`);
    expect(permits({ ref: 'refs/heads/main' })).toBe(true);
    expect(permits({ ref: 'refs/heads/feature' })).toBe(false);
    const checkout = workflow.jobs.deploy.steps.find(step => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.sha }}');
  });
  it('runs no validation, tests, migrations, smoke checks or artifact uploads on GitHub', () => {
    const commands = workflow.jobs.deploy.steps.map(step => step.run ?? step.uses ?? '').join('\n');
    expect(commands).toContain('vercel deploy --yes --prod');
    expect(commands).not.toMatch(/npm (?:ci|test)|typecheck|lint|playwright|vitest|schema:|content:|check-production|ci-release|migrate|curl|upload-artifact|github-script/);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(JSON.parse(readFileSync('vercel.json', 'utf8')).git.deploymentEnabled.main).toBe(false);
  });
  it('provides local validation that refuses a GitHub runner', () => {
    const local = readFileSync('scripts/verify-local.mjs', 'utf8');
    expect(local).toContain("process.env.GITHUB_ACTIONS === 'true'");
    expect(local).toContain('PGLITE_RUNTIME');
    expect(local).toContain('student-runtime');
    expect(local).not.toContain('SUPABASE_DB_URL');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['verify:local']).toBe('node scripts/verify-local.mjs');
  });
});

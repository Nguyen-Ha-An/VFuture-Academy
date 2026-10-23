import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Owner policy: all validation runs here, never on a GitHub Actions runner.
if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Run verify:local on your machine. GitHub is deployment-only.');
const full = process.argv.includes('--full');
const webpack = process.argv.includes('--webpack');
const run = (command, args, env = {}) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
};

for (const task of ['graphify:check', 'typecheck', 'lint']) run('npm', ['run', task]);
run('npm', ['test', '--', '--maxWorkers=2']);
for (const fixture of ['ai-foundations', 'all-question-types']) {
  run('npm', ['run', 'content:validate', '--', `src/content-engine/fixtures/${fixture}`, '--fixtures', '--publish']);
}
run('npm', ['run', 'schema:check']);
if (webpack) {
  // Useful on machines where Turbopack's temporary output exceeds free disk.
  // Keep the normal build and deployment path unchanged.
  run('npm', ['run', 'studio:worker']);
  run('npx', ['next', 'build'], { NEXT_TELEMETRY_DISABLED: '1', ACADEMY_BUILD_CACHE: '0' });
} else run('npm', ['run', 'build'], { NEXT_TELEMETRY_DISABLED: '1' });

const sqlRuntime = mkdtempSync(join(tmpdir(), 'vfuture-local-sql-'));
try {
  run('npm', ['install', '--prefix', sqlRuntime, '--ignore-scripts', '--no-audit', '--no-fund', '@electric-sql/pglite@0.5.8']);
  for (const script of ['verify-admin-migrations.mjs', 'verify-admin-foundation.mjs', 'verify-admin-management.mjs', 'verify-admin-content-review.mjs', 'verify-admin-content-publication.mjs', 'verify-notebook-foundation.mjs', 'verify-studio-transactions.mjs', 'verify-studio-workflow-concurrency.mjs', 'verify-security-catalog-quiz.mjs', 'verify-resource-create-ownership.mjs', 'fixtures/studio-assets-sql.mjs', 'fixtures/studio-reports-sql.mjs', 'verify-exam-result-availability.mjs', 'fixtures/exam-sweep-scheduler-sql.mjs', 'verify-studio-mcp-access-blocks.mjs']) {
    run(process.execPath, [`scripts/${script}`], {
      PGLITE_RUNTIME: join(sqlRuntime, 'node_modules/@electric-sql/pglite'),
      PGLITE_MODULE_PATH: sqlRuntime,
    });
  }
} finally { rmSync(sqlRuntime, { recursive: true, force: true }); }

const browsers = full ? ['chromium', 'firefox', 'webkit'] : ['chromium'];
run('npx', ['playwright', 'install', ...browsers]);
for (const config of ['studio', 'admin', 'student', 'student-runtime', ...(full ? ['student-visual'] : [])]) {
  const projects = config === 'student' || config === 'student-runtime' ? ['--project', ...browsers] : [];
  run('npx', ['playwright', 'test', '--config', `playwright.${config}.config.ts`, ...projects, '--reporter=line', '--trace', 'off'], { CI: 'true', STUDENT_CAPTURE_EVIDENCE: String(full) });
}
console.log('\nLocal verification passed. Database migrations, if any, are a separate production operation before merging.');

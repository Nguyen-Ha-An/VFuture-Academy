import { defineConfig } from '@playwright/test';
import studentConfig from './playwright.student.config';

const run = (process.env.STUDENT_RUNTIME_RUN ?? 'runtime-latest').replace(/[^a-zA-Z0-9_-]/g, '_');
const artifacts = `tests/e2e/student-harness/artifacts/${run}`;

// Reuse the existing aliases/server/engines read-only. This suite cannot enter the main *.spec.ts matrix.
export default defineConfig({
 ...studentConfig,
 testDir: './tests/e2e/student-harness',
 testMatch: '**/runtime.check.ts',
 timeout: 45_000,
 workers: 1,
 fullyParallel: false,
 outputDir: `${artifacts}/results`,
 reporter: [['list'], ['json', { outputFile: `${artifacts}/results.json` }], ['html', { open: 'never', outputFolder: `${artifacts}/report` }]],
 webServer: {
  command: './node_modules/.bin/vite --config tests/e2e/student-harness/vite.config.ts',
  url: 'http://127.0.0.1:4180/runtime.html',
  reuseExistingServer: false,
 },
});

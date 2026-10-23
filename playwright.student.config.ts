import { defineConfig, devices } from '@playwright/test';

const run = process.env.STUDENT_HARNESS_RUN?.replace(/[^a-zA-Z0-9_-]/g, '_');
const artifacts = `tests/e2e/student-harness/artifacts${run ? `/${run}` : ''}`;

export default defineConfig({
  timeout: 90_000,
  testDir: './tests/e2e/student-harness',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: `${artifacts}/results`,
  reporter: [['list'], ['json', { outputFile: `${artifacts}/results.json` }], ['html', { open: 'never', outputFolder: `${artifacts}/report` }]],
  use: { baseURL: 'http://127.0.0.1:4180', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: './node_modules/.bin/vite --config tests/e2e/student-harness/vite.config.ts', url: 'http://127.0.0.1:4180', reuseExistingServer: false },
});

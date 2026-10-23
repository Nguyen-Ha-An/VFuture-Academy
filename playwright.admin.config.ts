import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/admin-harness',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results-admin',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-admin' }]],
  use: { baseURL: 'http://127.0.0.1:4176', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --config tests/e2e/admin-harness/vite.config.ts',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: !process.env.CI,
  },
});

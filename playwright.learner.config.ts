import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/learner-harness',
  testMatch: '**/*.spec.ts',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4176', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx vite --config tests/e2e/learner-harness/vite.config.ts', url: 'http://127.0.0.1:4176', reuseExistingServer: !process.env.CI },
});

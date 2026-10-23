import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/studio-harness',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-studio' }]],
  use: { baseURL: 'http://127.0.0.1:4174', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run studio:worker && npx vite --config tests/e2e/studio-harness/vite.config.ts', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
});

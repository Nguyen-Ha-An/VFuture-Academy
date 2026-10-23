import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e/onboarding-integration',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90_000,
  outputDir: 'test-results/onboarding-integration',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3191', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node tests/e2e/onboarding-integration/server.mjs', url: 'http://127.0.0.1:3191/login', timeout: 120_000, reuseExistingServer: false },
});

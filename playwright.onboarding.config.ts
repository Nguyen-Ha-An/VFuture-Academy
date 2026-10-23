import { defineConfig, devices } from '@playwright/test';

const run = process.env.ONBOARDING_HARNESS_RUN?.replace(/[^a-zA-Z0-9_-]/g, '_');
const artifacts = `tests/e2e/onboarding-harness/artifacts${run ? `/${run}` : ''}`;

export default defineConfig({
  testDir: './tests/e2e/onboarding-harness',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  outputDir: `${artifacts}/results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${artifacts}/results.json` }],
    ['html', { open: 'never', outputFolder: `${artifacts}/report` }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4184',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: './node_modules/.bin/vite --config tests/e2e/onboarding-harness/vite.config.ts',
    url: 'http://127.0.0.1:4184/welcome',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

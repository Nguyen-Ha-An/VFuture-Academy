import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/studio-production',
  testMatch: '**/*.check.ts',
  workers: 1,
  outputDir: 'test-results-studio-production-ui',
  reporter: [['list'], ['json', { outputFile: 'test-results-studio-production-ui/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4182', bypassCSP: false },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1 --port 4182',
    url: 'http://127.0.0.1:4182/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'instui.check.ts', fullyParallel: false, workers: 1,
  timeout: 60_000,
  outputDir: '../../../test-results/instui-next',
  use: { baseURL: 'http://127.0.0.1:4339', browserName: 'chromium', headless: true },
  webServer: { command: 'node node_modules/next/dist/bin/next dev tests/e2e/instui-next-harness --port 4339 --hostname 127.0.0.1', cwd: '../../..', url: 'http://127.0.0.1:4339', timeout: 120_000, reuseExistingServer: false },
});

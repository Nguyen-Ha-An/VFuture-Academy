import { defineConfig, devices } from '@playwright/test';

// Intentionally independent of the default config: no global setup, reset, login,
// seed, or managed server. The operator starts a local production preview.
const baseURL = process.env.PUBLIC_E2E_BASE_URL ?? 'http://127.0.0.1:3103';
const target = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Public E2E is restricted to a local preview.');
}

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  outputDir: '../../../recovery-evidence/public-refactor/browser-results',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

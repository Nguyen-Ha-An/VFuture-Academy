import { defineConfig } from '@playwright/test';
import studentConfig from './playwright.student.config';

export default defineConfig({
  ...studentConfig,
  testDir: './tests/e2e/student-harness',
  testMatch: '**/notebook-ui.check.ts',
  outputDir: 'tests/e2e/student-harness/artifacts/notebook-ui/results',
  reporter: [['list']],
  use: { ...studentConfig.use, baseURL: 'http://127.0.0.1:4180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

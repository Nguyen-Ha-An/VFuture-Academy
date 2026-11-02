import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
/** Local popup contracts only: no hosted app, account, credential, or database. */
export default defineConfig({ testDir: '.', testMatch: 'auth-popup.browser.spec.ts', workers: 1, retries: 0, reporter: 'list', outputDir: resolve(process.cwd(), 'build/azure-core/popup-browser'), use: { browserName: 'chromium', headless: true, screenshot: 'only-on-failure' } });

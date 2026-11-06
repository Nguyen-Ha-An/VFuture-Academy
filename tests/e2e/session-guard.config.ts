import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
/** Actual guard/DOM semantics with a local session endpoint; no hosted account. */
export default defineConfig({ testDir: '.', testMatch: 'session-guard.browser.spec.ts', workers: 1, retries: 0, reporter: 'list', outputDir: resolve(process.cwd(), 'build/azure-core/session-guard-browser'), use: { browserName: 'chromium', headless: true, screenshot: 'only-on-failure' } });

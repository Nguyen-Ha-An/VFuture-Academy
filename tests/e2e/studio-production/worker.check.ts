import { test, expect } from '@playwright/test';
import { FIXTURES } from '../../../src/content-engine/fixtures';
import { createWorkspaceState } from '../../../src/features/studio/workspace-state';
import type { WorkspaceAnalysisResponse } from '../../../src/features/studio/ui/workspace-analysis';

test('production worker executes under real document and asset CSP', async ({ page, request }) => {
  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.headers()['content-security-policy']).toContain("worker-src 'self'");
  const asset = await request.get('/studio-workers/workspace-analysis.js');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('javascript');
  expect(asset.headers()['cache-control']).toContain('no-cache');
  const state = createWorkspaceState({ id: 'production-worker-test', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, baseVersionId: null, checklist: {}, updatedAt: '2026-09-08T00:00:00Z' });
  const result = await page.evaluate(state => new Promise<WorkspaceAnalysisResponse>((resolve, reject) => {
    const worker = new Worker('/studio-workers/workspace-analysis.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker did not reply under production CSP')); }, 5000);
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.postMessage({ id: 1, revision: 'production-smoke', state });
  }), state);
  expect(result.id).toBe(1);
  expect(result.analysis.payload).not.toBeNull();
  expect(result.analysis.diagnostics).toEqual([]);
});

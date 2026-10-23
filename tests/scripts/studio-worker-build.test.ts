import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { FIXTURES } from '@/content-engine/fixtures';
import { createWorkspaceState } from '@/features/studio/workspace-state';
import { buildContentSecurityPolicy, STUDIO_WORKER_SECURITY_HEADERS } from '@/lib/security-headers';

it('ships runnable self-contained JavaScript instead of raw TypeScript under the production CSP', () => {
  execFileSync(process.execPath, ['scripts/build-studio-worker.mjs']);
  const source = readFileSync('public/studio-workers/workspace-analysis.js', 'utf8');
  const outputs: Array<{ id: number; analysis: { payload: unknown; diagnostics: unknown[] } }> = [];
  const worker = { onmessage: null, postMessage: (value: typeof outputs[number]) => outputs.push(value) };
  const context = vm.createContext({ self: worker, URL, TextEncoder, TextDecoder, performance: { now: () => 0, measure: () => {} } });
  new vm.Script(source).runInContext(context);
  const state = createWorkspaceState({ id: 'draft-test', courseId: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, baseVersionId: null, checklist: {}, updatedAt: '2026-09-08T00:00:00Z' });
  context.message = JSON.stringify({ id: 1, revision: 'r1', state });
  vm.runInContext('self.onmessage({data:JSON.parse(message)})', context);
  expect(outputs[0]).toMatchObject({ id: 1, analysis: { diagnostics: [] } });
  expect(outputs[0].analysis.payload).not.toBeNull();
  expect(buildContentSecurityPolicy({nodeEnv:'production',nonce:'test'})).toContain("worker-src 'self'");
  expect(STUDIO_WORKER_SECURITY_HEADERS).toContainEqual({ key:'Cache-Control', value:'no-cache, max-age=0, must-revalidate' });
});

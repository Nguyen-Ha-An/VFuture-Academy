import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORWARD56_EVIDENCE, FORWARD56_PLAN, verifyForward56Artifact } from './forward-56-artifact.mjs';

// The private job has the checked archive in place of a working checkout.
export async function runForward56Job(mode, env = process.env) {
  if (!['verify','plan','apply'].includes(mode)) throw new Error('Invalid repair job operation');
  const first = verifyForward56Artifact();
  await import('pg');
  const proof = { source: first.source, packageContentSha256: first.contentSha256 };
  if (mode === 'verify') return { action: 'forward-56-package', ...proof };
  if (mode === 'apply' && !first.reviewedPlanSha256) throw new Error('Reviewed repair plan required');
  const evidence = JSON.parse(readFileSync(FORWARD56_EVIDENCE, 'utf8'));
  const plan = mode === 'apply' ? JSON.parse(readFileSync(FORWARD56_PLAN, 'utf8')).plan : undefined;
  function verifySource() {
    const current = verifyForward56Artifact();
    if (current.manifestSha256 !== first.manifestSha256) throw new Error('Repair archive changed');
    return current.source;
  }
  const { createAzureTargetClient } = await import('./target.mjs');
  const { createForward56Executor } = await import('./forward-56.mjs');
  const db = createAzureTargetClient(env, { statement_timeout: 120000 });
  const executor = createForward56Executor({ db, target: env, source: first.source, evidence, verifySource });
  try {
    verifySource();
    await db.connect();
    if (mode === 'plan') {
      const reviewed = await executor.plan();
      verifySource();
      return { action: 'forward-56-plan', plan: reviewed, ...proof };
    }
    const result = await executor.apply(plan);
    verifySource();
    return { action: 'forward-56-apply', outcome: result.action, filename: result.filename, ...proof };
  } finally { await db.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one operation');
    console.log(JSON.stringify(await runForward56Job(process.argv[2])));
  } catch (error) {
    const code = error?.code;
    console.error(JSON.stringify({ errorCode: 'FORWARD_56_FAILED', sqlState: /^[0-9A-Z]{5}$/.test(code ?? '') ? code : null }));
    process.exitCode = 1;
  }
}

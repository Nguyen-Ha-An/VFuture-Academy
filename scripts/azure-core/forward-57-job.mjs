import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES_PILOT_FILE, FILES_PILOT_SQL_SHA256 } from '../../infra/azure-core/archive-policy.mjs';
import { FORWARD57_PLAN, verifyForward57Artifact } from './forward-57-artifact.mjs';

export async function runForward57Job(mode, env = process.env) {
  if (!['verify', 'plan', 'apply'].includes(mode)) throw new Error('Invalid Files pilot job operation');
  const first = verifyForward57Artifact();
  await import('pg');
  const proof = { source: first.source, packageContentSha256: first.contentSha256 };
  if (mode === 'verify') return { action: 'forward-57-package', ...proof };
  if (mode === 'apply' && !first.reviewedPlanSha256) throw new Error('Reviewed Files pilot plan required');
  const reviewed = mode === 'apply' ? JSON.parse(readFileSync(FORWARD57_PLAN, 'utf8')).plan : undefined;
  function verifySource() {
    if (verifyForward57Artifact().manifestSha256 !== first.manifestSha256) throw new Error('Files pilot archive changed');
  }
  const { createAzureTargetClient } = await import('./target.mjs');
  const { createFilesPilotExecutor } = await import('./forward-57.mjs');
  const db = createAzureTargetClient(env, { statement_timeout: 15000 });
  const executor = createFilesPilotExecutor({ db, targetHost: env.AZURE_TARGET_HOST, verifySource });
  try {
    verifySource();
    await db.connect();
    if (mode === 'plan') {
      const plan = await executor.plan();
      verifySource();
      return { action: 'forward-57-plan', plan, ...proof };
    }
    const result = await executor.apply(reviewed);
    return { action: 'forward-57-apply', ...result, filename: FILES_PILOT_FILE, sqlSha256: FILES_PILOT_SQL_SHA256, ...proof };
  } finally { await db.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one operation');
    console.log(JSON.stringify(await runForward57Job(process.argv[2])));
  } catch (error) {
    const code = error?.code;
    console.error(JSON.stringify({ errorCode: 'FORWARD_57_FAILED', sqlState: /^[0-9A-Z]{5}$/.test(code ?? '') ? code : null }));
    process.exitCode = 1;
  }
}

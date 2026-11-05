import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForwardExecutor } from './forward.mjs';
import { createAzureTargetClient } from './target.mjs';

const planPath = new URL('../../build/azure-core/private/forward-plan.json', import.meta.url);
const evidencePath = new URL('../../build/azure-core/private/forward-deployment-evidence.json', import.meta.url);
const modes = {
  'plan-schema': { phase: 'schema', apply: false },
  'apply-schema': { phase: 'schema', apply: true },
  'plan-activate': { phase: 'activate', apply: false },
  'apply-activate': { phase: 'activate', apply: true },
};
const runtimeCodes = new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);
function safeFailure(error) {
  const code=typeof error?.code === 'string' ? error.code : '';
  return {errorCode:'FORWARD_FAILED',sqlState:/^[0-9A-Z]{5}$/.test(code) ? code : null,runtimeCode:runtimeCodes.has(code) ? code : null};
}
function fixedJson(path,read) {
  const bytes=read(path);
  if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024) throw new Error('Invalid packaged receipt');
  return JSON.parse(bytes.toString('utf8'));
}
/**
 * The external caller verifies live deployment readiness; this module only checks its packaged attestation.
 * @typedef {{connect: () => Promise<void>, end: () => Promise<void>}} ForwardClient
 * @typedef {{verified: boolean, reviewedSha: string, verifiedSha: string}} DeploymentEvidence
 * @typedef {{plan: (phase: string) => Promise<unknown>, apply: (phase: string, plan: unknown, evidence?: DeploymentEvidence) => Promise<{action: string, [key: string]: unknown}>}} ForwardExecutor
 * @typedef {{env?: Readonly<Record<string, string | undefined>>, read?: (path: URL) => Buffer, createClient?: (source: Readonly<Record<string, string | undefined>>, options: {statement_timeout?: number}) => ForwardClient, createExecutor?: (input: {db: ForwardClient, target: Readonly<Record<string, string | undefined>>}) => ForwardExecutor}} ForwardCliOptions
 * @param {string} mode
 * @param {ForwardCliOptions} [options]
 */
export async function runForwardCli(mode, { env=process.env, read=readFileSync, createClient=createAzureTargetClient, createExecutor=createForwardExecutor }={}) {
  const selected=Object.hasOwn(modes,mode) ? modes[mode] : null;
  if(!selected) throw new Error('Invalid forward mode');
  let plan;
  let evidence;
  if(selected.apply) {
    const receipt=fixedJson(planPath,read);
    if(!receipt || receipt.action!=='forward-plan' || receipt.phase!==selected.phase || !receipt.plan || receipt.plan.phase!==selected.phase) throw new Error('Invalid packaged plan');
    plan=receipt.plan;
    if(selected.phase==='activate') {
      const attestation=fixedJson(evidencePath,read);
      if(!attestation || attestation.rootVerifiedReady!==true || !/^[a-f0-9]{40}$/.test(attestation.reviewedSha ?? '') || attestation.verifiedSha!==attestation.reviewedSha) throw new Error('Invalid deployment evidence');
      evidence={verified:true,reviewedSha:attestation.reviewedSha,verifiedSha:attestation.verifiedSha};
    }
  }
  const db=createClient(env,{statement_timeout:120000});
  try {
    await db.connect();
    const executor=createExecutor({db,target:env});
    if(!selected.apply) return {action:'forward-plan',phase:selected.phase,plan:await executor.plan(selected.phase)};
    const {action:outcome,...details}=await executor.apply(selected.phase,plan,evidence);
    return {action:`forward-${selected.phase}`,...details,outcome};
  } finally {
    await db.end();
  }
}
async function main() {
  try {
    if(process.argv.length!==3) throw new Error('Invalid forward mode');
    console.log(JSON.stringify(await runForwardCli(process.argv[2])));
  } catch(error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();

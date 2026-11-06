import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAzureTargetClient } from './target.mjs';
import { createForward55Executor } from './forward-55.mjs';
import { assertForward53Source, captureForward53Source } from './forward-53-provenance.mjs';
import { forward55Evidence } from './forward-55-artifact.mjs';
import { createForward55PackageManifest } from './forward-55-package.mjs';

const planPath=new URL('../../build/azure-core/private/forward-55-plan.json',import.meta.url);
const evidencePath=new URL('../../build/azure-core/private/forward-55-v1-evidence.json',import.meta.url);
const runtimeCodes=new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);
function fixedJson(path){
  const bytes=readFileSync(path);
  if(bytes.length>64*1024)throw new Error('Invalid local forward receipt');
  return JSON.parse(bytes.toString('utf8'));
}
/**
 * Plan and apply require clean committed provenance; apply also verifies the exact reviewed artifact before connecting.
 * @param {string} mode
 * @param {Readonly<Record<string,string|undefined>>} [env]
 */
export async function runForward55Cli(mode,env=process.env,proof={captureSource:captureForward53Source,assertSource:assertForward53Source,verifyReviewed:createForward55PackageManifest}){
  if(mode!=='plan' && mode!=='apply')throw new Error('Invalid forward 55 mode');
  const evidence=forward55Evidence(fixedJson(evidencePath));
  if(evidence?.verified!==true || typeof evidence.activationSha!=='string' || !/^[a-f0-9]{40}$/.test(evidence.activationSha))throw new Error('Verified V1 activation evidence required');
  let reviewed;
  let source=proof.captureSource();
  if(mode==='apply'){
    const envelope=fixedJson(planPath);
    if(envelope?.action!=='forward-55-plan' || !envelope.plan || envelope.plan.activationSha!==evidence.activationSha)throw new Error('Reviewed forward 55 plan required');
    source=proof.assertSource(envelope.source);
    if(JSON.stringify(envelope.plan.source)!==JSON.stringify(source))throw new Error('Reviewed forward 55 source mismatch');
    proof.verifyReviewed(envelope,{v1Evidence:evidence});
    reviewed=envelope.plan;
  }
  const db=createAzureTargetClient(env,{statement_timeout:120000});
  try{
    await db.connect();
    const executor=createForward55Executor({db,target:env,expectedActivationSha:evidence.activationSha,expectedPredecessor:evidence.predecessor,source,
      ...(mode==='apply'?{verifySource:()=>proof.assertSource(source)}:{})});
    if(mode==='plan'){
      const plan=await executor.plan();
      if(plan.action==='noop' && (!/^[a-f0-9]{40}$/.test(plan.receiptSourceCommit??'') || !/^[a-f0-9]{40}$/.test(plan.receiptSourceTree??'')))throw new Error('Existing teacher assignment receipt lacks committed provenance');
      return {action:'forward-55-plan',source,plan};
    }
    const result=await executor.apply(reviewed);
    return {action:'forward-55-apply',outcome:result.action,filename:result.filename};
  }finally{await db.end();}
}
async function main(){
  try{if(process.argv.length!==3)throw new Error('Invalid forward 55 mode');console.log(JSON.stringify(await runForward55Cli(process.argv[2])));}
  catch(error){const code=typeof error?.code==='string'?error.code:'';console.error(JSON.stringify({errorCode:'FORWARD_55_FAILED',sqlState:/^[0-9A-Z]{5}$/.test(code)?code:null,runtimeCode:runtimeCodes.has(code)?code:null}));process.exitCode=1;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

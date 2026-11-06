import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAzureSchema } from './schema.mjs';
import { assertForward53Source } from './forward-53-provenance.mjs';
import { FORWARD55_BOUNDARY,forward55SourceFiles,forward55Evidence,validateForward55ReviewedPlan } from './forward-55-artifact.mjs';

const root=new URL('../../',import.meta.url);
const file='20261106010000_course_teaching_assignments.sql';

/**
 * Local source manifest used by the encrypted package builder; recheck every staged byte and provenance.
 * @param {{action:string,source:{sourceClean:boolean,sourceCommit:string|null,sourceTree:string|null},plan:{action:string,filename:string,source:unknown,activationSha:string,sourceSha256:string,azureSha256:string,identitySha256:string,migrations:unknown[],predecessor:Record<string,string>,teacherCutoverInventory:Record<string,number|boolean>,baseline:string,priorReceiptDigest:string,roleDigest:string,roleCount:number,receiptSourceCommit?:string|null,receiptSourceTree?:string|null}}} envelope
 * @param {{v1Evidence?:{verified:boolean,activationSha:string},provenanceOptions?:{git?:(args:string[])=>string,cwd?:string}}} [options]
 */
export function createForward55PackageManifest(envelope,{v1Evidence,provenanceOptions}={}){
  if(envelope?.action!=='forward-55-plan' || !envelope.plan || envelope.plan.filename!==file || !['apply','noop'].includes(envelope.plan.action))throw new Error('Reviewed forward 55 plan required');
  if(envelope.plan.action==='noop' && (!/^[a-f0-9]{40}$/.test(envelope.plan.receiptSourceCommit??'') || !/^[a-f0-9]{40}$/.test(envelope.plan.receiptSourceTree??'')))throw new Error('Existing teacher assignment receipt lacks committed provenance');
  forward55Evidence(v1Evidence);
  if(v1Evidence?.verified!==true || v1Evidence.activationSha!==envelope.plan.activationSha || !/^[a-f0-9]{40}$/.test(envelope.plan.activationSha)
    || envelope.plan.baseline!=='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'
    || !/^[a-f0-9]{64}$/.test(envelope.plan.priorReceiptDigest) || !/^[a-f0-9]{64}$/.test(envelope.plan.roleDigest)
    || !Number.isSafeInteger(envelope.plan.roleCount) || envelope.plan.roleCount<3)throw new Error('Invalid reviewed forward 55 evidence');
  const source=assertForward53Source(envelope.source,provenanceOptions);
  if(JSON.stringify(envelope.plan.source)!==JSON.stringify(source))throw new Error('Reviewed forward 55 source mismatch');
  const artifact=buildAzureSchema({through:FORWARD55_BOUNDARY});
  if(artifact.receipt.migrations.length!==59 || artifact.receipt.migrations[54].file!==file
    || artifact.receipt.migrations[54].sourceSha256!==envelope.plan.sourceSha256
    || artifact.receipt.migrations[54].azureSha256!==envelope.plan.azureSha256)throw new Error('Reviewed forward 55 artifact mismatch');
  validateForward55ReviewedPlan(envelope,v1Evidence,{entry:artifact.receipt.migrations[54],source});
  const paths=forward55SourceFiles();
  const files=paths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')}));
  assertForward53Source(source,provenanceOptions);
  const reviewedPlanSha256=createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  return {kind:'forward-55-local-source-manifest',source,activationSha:envelope.plan.activationSha,reviewedPlanSha256,files};
}
function main(){
  const planPath=new URL('../../build/azure-core/private/forward-55-plan.json',import.meta.url);
  const evidencePath=new URL('../../build/azure-core/private/forward-55-v1-evidence.json',import.meta.url);
  const bytes=readFileSync(planPath),evidenceBytes=readFileSync(evidencePath);
  if(bytes.length>64*1024 || evidenceBytes.length>64*1024)throw new Error('Invalid local forward receipt');
  console.log(JSON.stringify(createForward55PackageManifest(JSON.parse(bytes.toString('utf8')),{v1Evidence:JSON.parse(evidenceBytes.toString('utf8'))})));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==2)throw new Error('No options are accepted');main();}
  catch{console.error(JSON.stringify({errorCode:'FORWARD_55_PACKAGE_REJECTED'}));process.exitCode=1;}
}

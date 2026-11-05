import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAzureSchema } from './schema.mjs';
import { assertForward53Source } from './forward-53-provenance.mjs';

const root=new URL('../../',import.meta.url);
const file='20261105030000_exam_attachment_bindings.sql';
const fixed=[
  'scripts/azure-core/forward-53.mjs','scripts/azure-core/forward-53-cli.mjs',
  'scripts/azure-core/forward-53-provenance.mjs','scripts/azure-core/forward-53-package.mjs',
  'scripts/azure-core/target.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/bootstrap.sql',
  'scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql',
  'src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','infra/azure-core/postgres-roots.crt','package.json','package-lock.json',
];
/**
 * Local-only manifest. A future package builder must stage exactly these bytes and recheck provenance.
 * @param {{action:string,source:{sourceClean:boolean,sourceCommit:string|null,sourceTree:string|null},plan:{action:string,filename:string,source:unknown,activationSha:string,sourceSha256:string,azureSha256:string,baseline:string,priorReceiptDigest:string,roleDigest:string,roleCount:number,receiptSourceCommit?:string|null,receiptSourceTree?:string|null}}} envelope
 * @param {{v1Evidence?:{verified:boolean,activationSha:string},provenanceOptions?:{git?:(args:string[])=>string,cwd?:string}}} [options]
 */
export function createForward53PackageManifest(envelope,{v1Evidence,provenanceOptions}={}){
  if(envelope?.action!=='forward-53-plan' || !envelope.plan || envelope.plan.filename!==file || !['apply','noop'].includes(envelope.plan.action))throw new Error('Reviewed forward 53 plan required');
  if(envelope.plan.action==='noop' && (!/^[a-f0-9]{40}$/.test(envelope.plan.receiptSourceCommit??'') || !/^[a-f0-9]{40}$/.test(envelope.plan.receiptSourceTree??'')))throw new Error('Existing assessment receipt lacks committed provenance');
  if(v1Evidence?.verified!==true || v1Evidence.activationSha!==envelope.plan.activationSha || !/^[a-f0-9]{40}$/.test(envelope.plan.activationSha)
    || envelope.plan.baseline!=='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'
    || !/^[a-f0-9]{64}$/.test(envelope.plan.priorReceiptDigest) || !/^[a-f0-9]{64}$/.test(envelope.plan.roleDigest)
    || !Number.isSafeInteger(envelope.plan.roleCount) || envelope.plan.roleCount<3)throw new Error('Invalid reviewed forward 53 evidence');
  const source=assertForward53Source(envelope.source,provenanceOptions);
  if(JSON.stringify(envelope.plan.source)!==JSON.stringify(source))throw new Error('Reviewed forward 53 source mismatch');
  const artifact=buildAzureSchema({through:file});
  if(artifact.receipt.migrations.length!==53 || artifact.receipt.migrations[52].file!==file
    || artifact.receipt.migrations[52].sourceSha256!==envelope.plan.sourceSha256
    || artifact.receipt.migrations[52].azureSha256!==envelope.plan.azureSha256)throw new Error('Reviewed forward 53 artifact mismatch');
  const paths=[...fixed,...artifact.receipt.migrations.map(row=>`supabase/migrations/${row.file}`)];
  const files=paths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex')}));
  assertForward53Source(source,provenanceOptions);
  const reviewedPlanSha256=createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  return {kind:'forward-53-local-source-manifest',source,activationSha:envelope.plan.activationSha,reviewedPlanSha256,files};
}
function main(){
  const planPath=new URL('../../build/azure-core/private/forward-53-plan.json',import.meta.url);
  const evidencePath=new URL('../../build/azure-core/private/forward-53-v1-evidence.json',import.meta.url);
  const bytes=readFileSync(planPath),evidenceBytes=readFileSync(evidencePath);
  if(bytes.length>64*1024 || evidenceBytes.length>64*1024)throw new Error('Invalid local forward receipt');
  console.log(JSON.stringify(createForward53PackageManifest(JSON.parse(bytes.toString('utf8')),{v1Evidence:JSON.parse(evidenceBytes.toString('utf8'))})));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==2)throw new Error('No options are accepted');main();}
  catch{console.error(JSON.stringify({errorCode:'FORWARD_53_PACKAGE_REJECTED'}));process.exitCode=1;}
}

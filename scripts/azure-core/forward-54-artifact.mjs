// Fixed migration54 archive contract. No database or cloud client is constructed here.
import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,lstatSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { buildAzureSchema } from './schema.mjs';
export const FORWARD54_FILE='20261106000000_managed_profile_handles.sql';
export const FORWARD54_MANIFEST='build/azure-core/private/forward-54-source-manifest.json';
export const FORWARD54_EVIDENCE='build/azure-core/private/forward-54-v1-evidence.json';
export const FORWARD54_PLAN='build/azure-core/private/forward-54-plan.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function canonical54(value){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);}
export function forward54SourceFiles(){
 const built=buildAzureSchema({through:FORWARD54_FILE});
 if(built.receipt.migrations.length!==54||built.receipt.migrations[53].file!==FORWARD54_FILE)throw new Error('Unexpected fixed54 inventory');
 return ['scripts/azure-core/forward-53.mjs','scripts/azure-core/forward-54.mjs','scripts/azure-core/forward-54-cli.mjs','scripts/azure-core/forward-53-provenance.mjs','scripts/azure-core/forward-54-package.mjs','scripts/azure-core/forward-54-artifact.mjs','scripts/azure-core/forward-54-job.mjs','scripts/azure-core/target.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/baselines/identity-pre-handles.sql','scripts/azure-core/baselines/identity-post-handles.sql','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','infra/azure-core/postgres-roots.crt','package.json','package-lock.json',...built.receipt.migrations.map(row=>`supabase/migrations/${row.file}`)].sort();
}
export function forward54Evidence(value){
 if(!value||Object.keys(value).some(key=>!['verified','activationSha'].includes(key))||value.verified!==true||!/^[a-f0-9]{40}$/.test(value.activationSha??''))throw new Error('Verified fixed V1 evidence required');
 return value;
}
function cleanSource(value){return value&&Object.keys(value).length===3&&value.sourceClean===true&&/^[a-f0-9]{40}$/.test(value.sourceCommit??'')&&/^[a-f0-9]{40}$/.test(value.sourceTree??'');}
/** Pure semantic validation shared by local and relocated packaging, before any DB client. */
export function validateForward54ReviewedPlan(envelope,evidence,{entry,source}={}){
 forward54Evidence(evidence);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(!keys(envelope,['action','source','plan','packageContentSha256','encryptedPackageSha256','sourceManifestSha256'])||envelope.action!=='forward-54-plan'||!cleanSource(envelope.source)
  ||envelope.packageContentSha256!==undefined&&!sha(envelope.packageContentSha256)||envelope.encryptedPackageSha256!==undefined&&!sha(envelope.encryptedPackageSha256)||envelope.sourceManifestSha256!==undefined&&!sha(envelope.sourceManifestSha256))throw new Error('Reviewed forward54 envelope required');
 const plan=envelope.plan;
 if(!keys(plan,['action','filename','sourceSha256','azureSha256','identitySha256','baseline','activationSha','priorReceiptDigest','roleCount','roleDigest','workforceMappedCount','workforceEligibleCount','workforceExcludedCount','source','receiptSourceCommit','receiptSourceTree'])
  ||!['apply','noop'].includes(plan.action)||plan.filename!==FORWARD54_FILE||plan.baseline!=='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'
  ||!sha(plan.identitySha256)||plan.identitySha256!==hash(readFileSync(new URL('./baselines/identity-post-handles.sql',import.meta.url)))||plan.activationSha!==evidence.activationSha||!sha(plan.priorReceiptDigest)||!sha(plan.roleDigest)||!Number.isSafeInteger(plan.roleCount)||plan.roleCount<3||![plan.workforceMappedCount,plan.workforceEligibleCount,plan.workforceExcludedCount].every(value=>Number.isSafeInteger(value)&&value>=0)||plan.workforceMappedCount!==plan.workforceEligibleCount+plan.workforceExcludedCount
  ||!entry||plan.sourceSha256!==entry.sourceSha256||plan.azureSha256!==entry.azureSha256
  ||canonical54(plan.source)!==canonical54(envelope.source)||source&&canonical54(source)!==canonical54(envelope.source))throw new Error('Invalid reviewed forward54 plan');
 if(plan.action==='noop'? !/^[a-f0-9]{40}$/.test(plan.receiptSourceCommit??'')||!/^[a-f0-9]{40}$/.test(plan.receiptSourceTree??'') : Object.hasOwn(plan,'receiptSourceCommit')||Object.hasOwn(plan,'receiptSourceTree'))throw new Error('Invalid handle receipt provenance');
 return envelope;
}
function paths(root){
 const result=[];
 function walk(folder,prefix=''){
  for(const entry of readdirSync(folder,{withFileTypes:true})){
   const name=prefix?prefix+'/'+entry.name:entry.name,location=join(folder,entry.name),stat=lstatSync(location);
   if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new Error('Unsupported archive member');
   if(stat.isDirectory())walk(location,name);else result.push(name);
  }
 }
 walk(root);return result.sort();
}
export function createForward54ArtifactManifest({root=process.cwd(),source,evidence,reviewedPlan}={}){
 if(!cleanSource(source))throw new Error('Clean committed54 source required');
 forward54Evidence(evidence);
 const sourcePaths=forward54SourceFiles();
 const all=paths(root),vendor=all.filter(path=>path.startsWith('node_modules/'));
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
 const dependencies={};
 for(const path of vendor.filter(path=>/^node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path))){
  const pkg=JSON.parse(readFileSync(join(root,path),'utf8')),name=path.slice('node_modules/'.length,-'/package.json'.length);
  if(pkg.name!==name||lock.packages?.[`node_modules/${name}`]?.version!==pkg.version)throw new Error('Unlocked54 runtime dependency');
  dependencies[name]=pkg.version;
 }
 if(!dependencies.pg)throw new Error('Locked pg closure required');
 const files=[...sourcePaths,...vendor].sort().map(path=>({path,sha256:hash(readFileSync(join(root,path)))}));
 const basis={kind:'forward-54-source-v1',source,activationSha:evidence.activationSha,schemaSha256:buildAzureSchema({through:FORWARD54_FILE}).receipt.schemaSha256,evidenceSha256:hash(readFileSync(join(root,FORWARD54_EVIDENCE))),dependencies,files};
 const contentSha256=hash(canonical54(basis));
 if(reviewedPlan){validateForward54ReviewedPlan(reviewedPlan,evidence,{entry:buildAzureSchema({through:FORWARD54_FILE}).receipt.migrations[53],source});if(reviewedPlan.packageContentSha256!==contentSha256)throw new Error('Reviewed54 package content changed');}
 return {...basis,contentSha256,...(reviewedPlan?{reviewedPlanSha256:hash(readFileSync(join(root,FORWARD54_PLAN)))}:{})};
}
export function verifyForward54Artifact(root=process.cwd()){
 root=resolve(root);
 const bytes=readFileSync(join(root,FORWARD54_MANIFEST));if(bytes.length>4*1024*1024)throw new Error('Invalid54 source manifest');
 const manifest=JSON.parse(bytes),evidence=forward54Evidence(JSON.parse(readFileSync(join(root,FORWARD54_EVIDENCE),'utf8')));
 const expectedKeys=['kind','source','activationSha','schemaSha256','evidenceSha256','dependencies','files','contentSha256','reviewedPlanSha256'];
 if(Object.keys(manifest).some(key=>!expectedKeys.includes(key))||!Array.isArray(manifest.files))throw new Error('Invalid54 source manifest');
 const allowed=[...forward54SourceFiles(),FORWARD54_EVIDENCE,FORWARD54_MANIFEST,...(manifest.reviewedPlanSha256?[FORWARD54_PLAN]:[])];
 const actualPaths=paths(root),declared=manifest.files.map(row=>row.path);
 if(new Set(declared).size!==declared.length||declared.some(path=>typeof path!=='string'||!actualPaths.includes(path)||(!allowed.includes(path)&&!/^node_modules\/(?:@[^/]+\/)?[^/]+\/.+/.test(path)))||actualPaths.some(path=>!allowed.includes(path)&&!declared.includes(path)))throw new Error('Unexpected54 archive content');
 for(const row of manifest.files)if(!/^[a-f0-9]{64}$/.test(row.sha256??'')||hash(readFileSync(join(root,row.path)))!==row.sha256)throw new Error('Changed54 artifact file');
 const plan=manifest.reviewedPlanSha256?JSON.parse(readFileSync(join(root,FORWARD54_PLAN),'utf8')):undefined;
 const rebuilt=createForward54ArtifactManifest({root,source:manifest.source,evidence,reviewedPlan:plan});
 if(canonical54(rebuilt)!==canonical54(manifest))throw new Error('54 artifact manifest mismatch');
 return {...manifest,manifestSha256:hash(bytes)};
}

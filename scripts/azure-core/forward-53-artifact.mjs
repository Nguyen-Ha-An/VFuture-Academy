// Fixed migration53 archive contract. No database or cloud client is constructed here.
import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,lstatSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { buildAzureSchema } from './schema.mjs';
export const FORWARD53_FILE='20261105030000_exam_attachment_bindings.sql';
export const FORWARD53_MANIFEST='build/azure-core/private/forward-53-source-manifest.json';
export const FORWARD53_EVIDENCE='build/azure-core/private/forward-53-v1-evidence.json';
export const FORWARD53_PLAN='build/azure-core/private/forward-53-plan.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function canonical53(value){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);}
export function forward53SourceFiles(){
 const built=buildAzureSchema({through:FORWARD53_FILE});
 if(built.receipt.migrations.length!==53||built.receipt.migrations[52].file!==FORWARD53_FILE)throw new Error('Unexpected fixed53 inventory');
 return ['scripts/azure-core/forward-53.mjs','scripts/azure-core/forward-53-cli.mjs','scripts/azure-core/forward-53-provenance.mjs','scripts/azure-core/forward-53-package.mjs','scripts/azure-core/forward-53-artifact.mjs','scripts/azure-core/forward-53-job.mjs','scripts/azure-core/target.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/baselines/identity-pre-handles.sql','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','infra/azure-core/postgres-roots.crt','package.json','package-lock.json',...built.receipt.migrations.map(row=>`supabase/migrations/${row.file}`)].sort();
}
export function forward53Evidence(value){
 if(!value||Object.keys(value).some(key=>!['verified','activationSha'].includes(key))||value.verified!==true||!/^[a-f0-9]{40}$/.test(value.activationSha??''))throw new Error('Verified fixed V1 evidence required');
 return value;
}
function cleanSource(value){return value&&Object.keys(value).length===3&&value.sourceClean===true&&/^[a-f0-9]{40}$/.test(value.sourceCommit??'')&&/^[a-f0-9]{40}$/.test(value.sourceTree??'');}
/** Pure semantic validation shared by local and relocated packaging, before any DB client. */
export function validateForward53ReviewedPlan(envelope,evidence,{entry,source}={}){
 forward53Evidence(evidence);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(!keys(envelope,['action','source','plan','packageContentSha256','encryptedPackageSha256','sourceManifestSha256'])||envelope.action!=='forward-53-plan'||!cleanSource(envelope.source)
  ||envelope.packageContentSha256!==undefined&&!sha(envelope.packageContentSha256)||envelope.encryptedPackageSha256!==undefined&&!sha(envelope.encryptedPackageSha256)||envelope.sourceManifestSha256!==undefined&&!sha(envelope.sourceManifestSha256))throw new Error('Reviewed forward53 envelope required');
 const plan=envelope.plan;
 if(!keys(plan,['action','filename','sourceSha256','azureSha256','baseline','activationSha','priorReceiptDigest','roleCount','roleDigest','source','receiptSourceCommit','receiptSourceTree'])
  ||!['apply','noop'].includes(plan.action)||plan.filename!==FORWARD53_FILE||plan.baseline!=='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'
  ||plan.activationSha!==evidence.activationSha||!sha(plan.priorReceiptDigest)||!sha(plan.roleDigest)||!Number.isSafeInteger(plan.roleCount)||plan.roleCount<3
  ||!entry||plan.sourceSha256!==entry.sourceSha256||plan.azureSha256!==entry.azureSha256
  ||canonical53(plan.source)!==canonical53(envelope.source)||source&&canonical53(source)!==canonical53(envelope.source))throw new Error('Invalid reviewed forward53 plan');
 if(plan.action==='noop'? !/^[a-f0-9]{40}$/.test(plan.receiptSourceCommit??'')||!/^[a-f0-9]{40}$/.test(plan.receiptSourceTree??'') : Object.hasOwn(plan,'receiptSourceCommit')||Object.hasOwn(plan,'receiptSourceTree'))throw new Error('Invalid assessment receipt provenance');
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
export function createForward53ArtifactManifest({root=process.cwd(),source,evidence,reviewedPlan}={}){
 if(!cleanSource(source))throw new Error('Clean committed53 source required');
 forward53Evidence(evidence);
 const sourcePaths=forward53SourceFiles();
 const all=paths(root),vendor=all.filter(path=>path.startsWith('node_modules/'));
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
 const dependencies={};
 for(const path of vendor.filter(path=>/^node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path))){
  const pkg=JSON.parse(readFileSync(join(root,path),'utf8')),name=path.slice('node_modules/'.length,-'/package.json'.length);
  if(pkg.name!==name||lock.packages?.[`node_modules/${name}`]?.version!==pkg.version)throw new Error('Unlocked53 runtime dependency');
  dependencies[name]=pkg.version;
 }
 if(!dependencies.pg)throw new Error('Locked pg closure required');
 const files=[...sourcePaths,...vendor].sort().map(path=>({path,sha256:hash(readFileSync(join(root,path)))}));
 const basis={kind:'forward-53-source-v1',source,activationSha:evidence.activationSha,schemaSha256:buildAzureSchema({through:FORWARD53_FILE}).receipt.schemaSha256,evidenceSha256:hash(readFileSync(join(root,FORWARD53_EVIDENCE))),dependencies,files};
 const contentSha256=hash(canonical53(basis));
 if(reviewedPlan){validateForward53ReviewedPlan(reviewedPlan,evidence,{entry:buildAzureSchema({through:FORWARD53_FILE}).receipt.migrations[52],source});if(reviewedPlan.packageContentSha256!==contentSha256)throw new Error('Reviewed53 package content changed');}
 return {...basis,contentSha256,...(reviewedPlan?{reviewedPlanSha256:hash(readFileSync(join(root,FORWARD53_PLAN)))}:{})};
}
export function verifyForward53Artifact(root=process.cwd()){
 root=resolve(root);
 const bytes=readFileSync(join(root,FORWARD53_MANIFEST));if(bytes.length>4*1024*1024)throw new Error('Invalid53 source manifest');
 const manifest=JSON.parse(bytes),evidence=forward53Evidence(JSON.parse(readFileSync(join(root,FORWARD53_EVIDENCE),'utf8')));
 const expectedKeys=['kind','source','activationSha','schemaSha256','evidenceSha256','dependencies','files','contentSha256','reviewedPlanSha256'];
 if(Object.keys(manifest).some(key=>!expectedKeys.includes(key))||!Array.isArray(manifest.files))throw new Error('Invalid53 source manifest');
 const allowed=[...forward53SourceFiles(),FORWARD53_EVIDENCE,FORWARD53_MANIFEST,...(manifest.reviewedPlanSha256?[FORWARD53_PLAN]:[])];
 const actualPaths=paths(root),declared=manifest.files.map(row=>row.path);
 if(new Set(declared).size!==declared.length||declared.some(path=>typeof path!=='string'||!actualPaths.includes(path)||(!allowed.includes(path)&&!/^node_modules\/(?:@[^/]+\/)?[^/]+\/.+/.test(path)))||actualPaths.some(path=>!allowed.includes(path)&&!declared.includes(path)))throw new Error('Unexpected53 archive content');
 for(const row of manifest.files)if(!/^[a-f0-9]{64}$/.test(row.sha256??'')||hash(readFileSync(join(root,row.path)))!==row.sha256)throw new Error('Changed53 artifact file');
 const plan=manifest.reviewedPlanSha256?JSON.parse(readFileSync(join(root,FORWARD53_PLAN),'utf8')):undefined;
 const rebuilt=createForward53ArtifactManifest({root,source:manifest.source,evidence,reviewedPlan:plan});
 if(canonical53(rebuilt)!==canonical53(manifest))throw new Error('53 artifact manifest mismatch');
 return {...manifest,manifestSha256:hash(bytes)};
}

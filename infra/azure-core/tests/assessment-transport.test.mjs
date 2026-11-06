// Real encrypted/relocated source and CLI/executor; only the pg transport and
// Azure HTTP are doubled. Native SQL compatibility has its separate rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { createHash,createDecipheriv } from 'node:crypto';
import { forward53SourceFiles,FORWARD53_EVIDENCE,FORWARD53_PLAN,FORWARD53_MANIFEST,verifyForward53Artifact } from '../../../scripts/azure-core/forward-53-artifact.mjs';
import { ASSESSMENT_ACTIONS,validateAssessmentReceipt,validateArchiveListing,tarListingArguments } from '../archive-policy.mjs';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';
const source=fileURLToPath(new URL('../../../',import.meta.url));
const env={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const activation='a'.repeat(40),host='fixture.postgres.database.azure.com',vault='vfakvabcdefghijklm.vault.azure.net';
function run(root,file,args=[],extra={}){return spawnSync(process.execPath,[file,...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});}
function copy(root,path){mkdirSync(join(root,path,'..'),{recursive:true});cpSync(join(source,path),join(root,path),{recursive:true});}
function prepare(){
 const root=mkdtempSync(join(tmpdir(),'academy-assessment-source-'));
 for(const path of [...forward53SourceFiles(),'infra/azure-core/archive-policy.mjs','infra/azure-core/migration/package.mjs','infra/azure-core/migration/verify-package.mjs','infra/azure-core/migration/deploy.mjs','infra/azure-core/migration/bootstrap.mjs','infra/azure-core/migration-job.bicep'])copy(root,path);
 writeFileSync(join(root,'.gitignore'),'node_modules\nbuild/\n');symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
 for(const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgSign=false','-c','core.hooksPath=/dev/null','commit','-qm','Fixed assessment transport fixture']])execFileSync('git',args,{cwd:root,stdio:'pipe'});
 mkdirSync(join(root,'build/azure-core/private'),{recursive:true});writeFileSync(join(root,FORWARD53_EVIDENCE),JSON.stringify({verified:true,activationSha:activation}));
 return root;
}
function package53(root){const result=run(root,'infra/azure-core/migration/package.mjs',['--forward-53']);assert.equal(result.status,0,result.stderr);return JSON.parse(readFileSync(join(root,'build/azure-core/migration-package-receipt.json')));}
function extract(root,receipt){
 const folder=mkdtempSync(join(tmpdir(),'academy-assessment-relocated-'));
 const bytes=readFileSync(join(root,'build/azure-core/private',receipt.blobName)),key=Buffer.from(readFileSync(join(root,'build/azure-core/private/migration-package-key.txt'),'utf8'),'base64');
 const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const archive=join(folder,'archive.tgz');writeFileSync(archive,Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]));key.fill(0);
 const version=execFileSync('tar',['--version'],{encoding:'utf8',env});validateArchiveListing(execFileSync('tar',tarListingArguments(archive,version),{encoding:'utf8',env}));execFileSync('tar',['-xzf',archive,'-C',folder],{env,stdio:'pipe'});rmSync(archive);return folder;
}
function support(){
 const folder=mkdtempSync(join(tmpdir(),'academy-assessment-transport-')),stateFile=join(folder,'state.json'),preload=join(folder,'pg-double.mjs');
 const built=buildAzureSchema({through:'20261105030000_exam_attachment_bindings.sql'});
 writeFileSync(stateFile,JSON.stringify({receipt:null,events:[],prior:built.receipt.migrations.slice(49,52).map((row,index)=>({filename:row.file,source_sha256:row.sourceSha256,azure_sha256:row.azureSha256,deployment_sha:index===2?activation:null}))}));
 writeFileSync(preload,`import {createRequire} from 'node:module';import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';const{Client}=createRequire(join(process.cwd(),'package.json'))('pg');const file=process.env.TEST_STATE_FILE;const load=()=>JSON.parse(readFileSync(file));const save=s=>writeFileSync(file,JSON.stringify(s));Client.prototype.connect=async function(){if(this.host!=='${host}'||this.database!=='academy'||this.user!=='academy_admin'||this.ssl.rejectUnauthorized!==true)throw Error('Unsafe actual pg target');const s=load();s.events.push('CONNECT_TLS_VERIFIED_CONFIG');save(s);};Client.prototype.end=async()=>{};Client.prototype.query=async function(sql,params){const s=load();const reply=rows=>({rows});if(sql.includes('current_database()'))return reply([{database:'academy',username:'academy_admin',version:'170011'}]);if(sql.includes('from academy_private.migration_state'))return reply([{state:'imported',schema_sha256:'273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'}]);if(sql.includes('from academy_private.canvas_forward_receipts'))return reply(s.prior);if(sql.includes('role_definitions_protect_built_in'))return reply([{n:1}]);if(sql.includes('array_send(permissions)'))return reply([{id:'central_admin',built_in:true,permissions:['teaching.announcement.manage','teaching.schedule.manage'],permission_bytes:'abcd'},{id:'school_admin',built_in:true,permissions:[],permission_bytes:'00'},{id:'teacher',built_in:true,permissions:['teaching.announcement.manage','teaching.schedule.manage'],permission_bytes:'00'}]);if(sql.includes('as v1_boundaries'))return reply([{v1_boundaries:true}]);if(sql.includes('as receipt_exists'))return reply([{receipt_exists:!!s.receipt,exam_table:!!s.receipt,quiz_table:!!s.receipt,function_count:s.receipt?17:0,trigger_count:s.receipt?6:0}]);if(sql.includes('from academy_private.assessment_forward_receipt'))return reply(s.receipt?[s.receipt]:[]);if(sql.includes('as postconditions'))return reply([{postconditions:true}]);if(sql.includes('create table public.exam_attachment_bindings'))s.events.push('APPLY_ONLY53');if(sql.includes('insert into academy_private.assessment_forward_receipt'))s.receipt={filename:params[0],source_sha256:params[1],azure_sha256:params[2],source_commit:params[3],source_tree:params[4]};if(sql.includes('update academy_private.migration_state')||sql.includes('update public.role_definitions'))throw Error('V1 rewrite');if(sql==='begin read only')s.events.push('READ_ONLY');if(sql.includes('notify pgrst'))s.events.push('CACHE_RELOAD');save(s);return reply([]);};`);
 return {folder,stateFile,preload};
}
function bootstrap(root,receipt,action,s){
 const encrypted=readFileSync(join(root,'build/azure-core/private',receipt.blobName)),key=readFileSync(join(root,'build/azure-core/private/migration-package-key.txt'),'utf8');
 const receiptFile=join(s.folder,action+'.json'),failureFile=receiptFile+'.failure';
 const mock=`globalThis.fetch=async(input,options={})=>{const u=new URL(String(input));if(u.origin==='http://identity')return{ok:true,json:async()=>({access_token:'NEVER_LOG_TOKEN'})};if(u.hostname==='${vault}')return{status:200,json:async()=>({value:u.pathname.includes('/migration-key-')?'${key}':'postgresql://academy_admin:NEVER_LOG_PASSWORD@${host}/academy?sslmode=verify-full'})};if(u.hostname!=='example.blob.core.windows.net')throw Error('unexpected network');if(options.method==='PUT'){if(options.headers['If-None-Match']!=='*')throw Error('mutable receipt');const{writeFileSync}=await import('node:fs');writeFileSync(u.pathname.endsWith('.failure.json')?'${failureFile}':'${receiptFile}',Buffer.from(options.body));return{ok:true};}return{ok:true,arrayBuffer:async()=>Buffer.from('${encrypted.toString('base64')}','base64')};};\n`;
 const code=mock+readFileSync(join(root,'infra/azure-core/archive-policy.mjs'),'utf8')+'\n'+readFileSync(join(root,'infra/azure-core/migration/bootstrap.mjs'),'utf8');
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8',env:{...env,NODE_OPTIONS:`--import=${s.preload}`,TEST_STATE_FILE:s.stateFile,MIGRATION_ACTION:action,IDENTITY_ENDPOINT:'http://identity/',IDENTITY_HEADER:'NEVER_LOG_HEADER',AZURE_CLIENT_ID:'fixture',AZURE_TARGET_HOST:host,MIGRATION_VAULT_HOST:vault,MIGRATION_ADMIN_SECRET_URL:`https://${vault}/secrets/migration-admin-uri`,MIGRATION_PACKAGE_KEY_SECRET_URL:`https://${vault}/secrets/migration-key-${receipt.sha256.slice(0,16)}`,MIGRATION_PACKAGE_URL:'https://example.blob.core.windows.net/migration-packages/fixed.enc',MIGRATION_PACKAGE_SHA256:receipt.sha256,MIGRATION_RECEIPT_URL:'https://example.blob.core.windows.net/migration-receipts/fixed.json',MIGRATION_SOURCE_MANIFEST_SHA256:receipt.sourceManifestSha256,MIGRATION_PACKAGE_CONTENT_SHA256:receipt.packageContentSha256,MIGRATION_SOURCE_COMMIT:receipt.sourceCommit,MIGRATION_SOURCE_TREE:receipt.sourceTree}});
 assert.equal((result.stdout+result.stderr).includes('NEVER_LOG'),false);return {...result,receiptFile,failureFile};
}
test('fixed53 plan/apply receipt policy never widens V1 or exports private rows',()=>{
 assert.deepEqual(Object.keys(ASSESSMENT_ACTIONS),['forward-54-plan','forward-54-apply','forward-53-plan','forward-53-apply']);
 for(const path of ['build/azure-core/private/forward-53-v1-evidence.json','build/azure-core/private/forward-53-plan.json','build/azure-core/private/forward-53-source-manifest.json'])assert.doesNotThrow(()=>validateArchiveListing(path));
 for(const path of ['build/azure-core/private/forward-53-other.json','scripts/azure-core/forward-55.mjs'])assert.throws(()=>validateArchiveListing(path));
});
test('real clean encrypted53 package relocates, produces reviewed transport plan, repacks and applies idempotently',()=>{
 const root=prepare(),s=support();let relocated,applyFolder;
 try{
  const first=package53(root);assert.equal(first.packageType,'forward-53');assert.equal(first.reviewedPlanSha256,null);
  const missingPlan=bootstrap(root,first,'forward-53-apply',s);assert.notEqual(missingPlan.status,0);assert.equal(JSON.parse(readFileSync(missingPlan.failureFile)).stage,'verify_assessment_artifact');assert.deepEqual(JSON.parse(readFileSync(s.stateFile)).events,[]);
  const encryptedPath=join(root,'build/azure-core/private',first.blobName),encrypted=readFileSync(encryptedPath);writeFileSync(encryptedPath,Buffer.concat([encrypted,Buffer.from('tamper')]));const tampered=bootstrap(root,first,'forward-53-plan',s);assert.notEqual(tampered.status,0);assert.equal(JSON.parse(readFileSync(tampered.failureFile)).stage,'verify_ciphertext');assert.deepEqual(JSON.parse(readFileSync(s.stateFile)).events,[]);writeFileSync(encryptedPath,encrypted);
  relocated=extract(root,first);const verified=verifyForward53Artifact(relocated);assert.equal(verified.contentSha256,first.packageContentSha256);assert.equal(verified.files.some(row=>row.path.includes('source-snapshot')),false);assert.equal(verified.files.some(row=>row.path.endsWith('/migrate.mjs')),false);assert.ok(verified.dependencies.pg);
  const offline=run(root,'infra/azure-core/migration/verify-package.mjs');assert.equal(offline.status,0,offline.stderr);
  const planRun=bootstrap(root,first,'forward-53-plan',s);assert.equal(planRun.status,0,planRun.stderr);const plan=JSON.parse(readFileSync(planRun.receiptFile));validateAssessmentReceipt(plan,'forward-53-plan',{transport:true});assert.equal(plan.encryptedPackageSha256,first.sha256);assert.equal(plan.sourceManifestSha256,first.sourceManifestSha256);assert.equal(plan.plan.action,'apply');assert.equal(JSON.parse(readFileSync(s.stateFile)).receipt,null);
  writeFileSync(join(root,FORWARD53_PLAN),JSON.stringify(plan));const second=package53(root);assert.equal(second.packageContentSha256,first.packageContentSha256);assert.notEqual(second.sha256,first.sha256);assert.notEqual(second.sourceManifestSha256,first.sourceManifestSha256);assert.ok(second.reviewedPlanSha256);
  applyFolder=extract(root,second);
  const applied=bootstrap(root,second,'forward-53-apply',s);assert.equal(applied.status,0,applied.stderr);const receipt=JSON.parse(readFileSync(applied.receiptFile));validateAssessmentReceipt(receipt,'forward-53-apply',{transport:true});assert.equal(receipt.outcome,'applied');assert.equal(receipt.encryptedPackageSha256,second.sha256);
  const state=JSON.parse(readFileSync(s.stateFile));assert.equal(state.receipt.source_commit,second.sourceCommit);assert.equal(state.events.filter(value=>value==='APPLY_ONLY53').length,1);assert.ok(state.events.includes('CACHE_RELOAD'));assert.ok(state.events.includes('READ_ONLY'));
  const replay=bootstrap(root,second,'forward-53-plan',s);assert.equal(replay.status,0,replay.stderr);const replayPlan=JSON.parse(readFileSync(replay.receiptFile));assert.equal(replayPlan.plan.action,'noop');
  writeFileSync(join(root,FORWARD53_PLAN),JSON.stringify(replayPlan));const third=package53(root);const noop=bootstrap(root,third,'forward-53-apply',s);assert.equal(noop.status,0,noop.stderr);assert.equal(JSON.parse(readFileSync(noop.receiptFile)).outcome,'noop');assert.equal(JSON.parse(readFileSync(s.stateFile)).events.filter(value=>value==='APPLY_ONLY53').length,1);
  const manifestBytes=readFileSync(join(applyFolder,FORWARD53_MANIFEST)),planBytes=readFileSync(join(applyFolder,FORWARD53_PLAN)),evidenceBytes=readFileSync(join(applyFolder,FORWARD53_EVIDENCE));
  const connects=()=>JSON.parse(readFileSync(s.stateFile)).events.filter(value=>value==='CONNECT_TLS_VERIFIED_CONFIG').length;
  const beforeConnects=connects();
  // Even a rewritten raw-plan digest cannot make malformed semantics reach connect.
  const malformed=JSON.stringify({...plan,plan:{...plan.plan,roleCount:0}});writeFileSync(join(applyFolder,FORWARD53_PLAN),malformed);
  writeFileSync(join(applyFolder,FORWARD53_MANIFEST),JSON.stringify({...JSON.parse(manifestBytes),reviewedPlanSha256:hash(malformed)}));
  const invalid=run(applyFolder,'scripts/azure-core/forward-53-job.mjs',['apply'],{NODE_OPTIONS:`--import=${s.preload}`,TEST_STATE_FILE:s.stateFile,AZURE_TARGET_HOST:host,AZURE_DATABASE_URL:`postgresql://academy_admin:fixture@${host}/academy?sslmode=verify-full`});assert.notEqual(invalid.status,0);assert.equal(connects(),beforeConnects);
  writeFileSync(join(applyFolder,FORWARD53_PLAN),planBytes);writeFileSync(join(applyFolder,FORWARD53_MANIFEST),manifestBytes);
  writeFileSync(join(applyFolder,FORWARD53_EVIDENCE),JSON.stringify({verified:true,activationSha:'b'.repeat(40)}));assert.throws(()=>verifyForward53Artifact(applyFolder));writeFileSync(join(applyFolder,FORWARD53_EVIDENCE),evidenceBytes);
  const cli=join(applyFolder,'scripts/azure-core/forward-53-cli.mjs'),originalCli=readFileSync(cli);writeFileSync(cli,'changed source');assert.throws(()=>verifyForward53Artifact(applyFolder));writeFileSync(cli,originalCli);
  for(const changed of [{rows:['private']},{packageContentSha256:'0'.repeat(64)},{plan:{...plan.plan,filename:'other.sql'}}]){writeFileSync(join(root,FORWARD53_PLAN),JSON.stringify({...plan,...changed}));assert.notEqual(run(root,'infra/azure-core/migration/package.mjs',['--forward-53']).status,0);}
  writeFileSync(join(root,FORWARD53_PLAN),JSON.stringify(plan));writeFileSync(join(root,FORWARD53_EVIDENCE),JSON.stringify({verified:true,activationSha:'b'.repeat(40)}));assert.notEqual(run(root,'infra/azure-core/migration/package.mjs',['--forward-53']).status,0);
  writeFileSync(join(root,'scripts/azure-core/forward-53.mjs'),'changed source');assert.notEqual(run(root,'infra/azure-core/migration/package.mjs',['--forward-53']).status,0);
  const vendor=verified.files.find(row=>row.path==='node_modules/pg/lib/index.js');assert.ok(vendor);writeFileSync(join(relocated,vendor.path),'changed vendor');assert.throws(()=>verifyForward53Artifact(relocated));
 }finally{if(relocated)rmSync(relocated,{recursive:true,force:true});if(applyFolder)rmSync(applyFolder,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});rmSync(s.folder,{recursive:true,force:true});}
});

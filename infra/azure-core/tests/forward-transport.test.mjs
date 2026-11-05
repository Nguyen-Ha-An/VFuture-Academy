import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { createHash,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { FORWARD_ACTIONS,validateForwardReceipt,validateArchiveListing,tarListingArguments } from '../archive-policy.mjs';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';

const source=fileURLToPath(new URL('../../../',import.meta.url));
const archiveEnv={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
const schemaFiles=['20261105000000_teaching_canvas.sql','20261105010000_teaching_announcement_revisions.sql'];
const activationFile='20261105020000_teaching_permissions_activation.sql';
function plan(phase='schema',receiptCount=0){
  const files=phase==='schema'?schemaFiles:[activationFile];
  return {action:'forward-plan',phase,plan:{phase,action:(phase==='schema'?receiptCount>=2:receiptCount===3)?'noop':'apply',files,sourceHashes:files.map(()=> 'a'.repeat(64)),azureHashes:files.map(()=> 'b'.repeat(64)),receiptCount,serverMajor:17,baseline:'c'.repeat(64),roleCount:3,roleDigest:'e'.repeat(64),...(receiptCount===3?{deploymentSha:'d'.repeat(40)}:{})}};
}
test('four fixed actions admit only their exact phase, envelope and metadata',()=>{
  const cases=[['forward-plan',plan()],['forward-schema',{action:'forward-schema',phase:'schema',receiptCount:2,outcome:'applied'}],['forward-activation-plan',plan('activate',2)],['forward-activate',{action:'forward-activate',phase:'activate',receiptCount:3,outcome:'applied'}]];
  assert.deepEqual(Object.values(FORWARD_ACTIONS).map(value=>value.mode),['plan-schema','apply-schema','plan-activate','apply-activate']);
  for(const [action,receipt] of cases){
    assert.equal(validateForwardReceipt(receipt,action),receipt);
    for(const other of cases.map(row=>row[0]).filter(value=>value!==action))assert.throws(()=>validateForwardReceipt(receipt,other));
    assert.throws(()=>validateForwardReceipt({...receipt,rows:[{email:'private'}]},action));
    assert.throws(()=>validateForwardReceipt({...receipt,phase:'other'},action));
  }
  assert.equal(validateForwardReceipt(plan('schema',3),'forward-plan').plan.action,'noop');
  assert.equal(validateForwardReceipt({action:'forward-schema',phase:'schema',receiptCount:3,outcome:'noop'},'forward-schema').outcome,'noop');
  for(const change of [{files:['../arbitrary.sql']},{sourceHashes:['secret']},{receiptCount:1},{serverMajor:18},{baseline:'secret'},{rows:['private']},{action:'noop'}])assert.throws(()=>validateForwardReceipt({...plan(),plan:{...plan().plan,...change}},'forward-plan'));
  for(const [phase,count,action] of [['schema',0,'forward-plan'],['activate',2,'forward-activation-plan']]){
    for(const change of [{roleCount:undefined},{roleCount:2},{roleCount:-1},{roleCount:3.5},{roleCount:'3'},{roleCount:Number.MAX_SAFE_INTEGER+1},{roleDigest:undefined},{roleDigest:'e'.repeat(63)},{roleDigest:'E'.repeat(64)},{roleDigest:'private'},{roleRows:['private']}]){
      const receipt=plan(phase,count);
      assert.throws(()=>validateForwardReceipt(JSON.parse(JSON.stringify({...receipt,plan:{...receipt.plan,...change}})),action));
    }
  }
  assert.throws(()=>validateForwardReceipt(plan('activate',0),'forward-activation-plan'));
});
test('archive additions admit the two fixed forward inputs and scripts, never adjacent private data',()=>{
  const accepted=['scripts/azure-core/forward.mjs','scripts/azure-core/forward-cli.mjs','build/azure-core/private/forward-plan.json','build/azure-core/private/forward-deployment-evidence.json'];
  assert.equal(validateArchiveListing(accepted.join('\n')).files,4);
  for(const path of ['scripts/azure-core/forward-other.mjs','build/azure-core/private/forward-plan-secret.json','build/azure-core/private/database.env','build/azure-core/private/../credentials.json'])assert.throws(()=>validateArchiveListing(path));
});
test('actual deploy prepare admits only an exclusive matching package action and creates distinct immutable receipt destinations',()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-forward-deploy-'));
  try{
    for(const path of ['infra/azure-core/migration','scripts/azure-core','build/azure-core/private','bin'])mkdirSync(join(root,path),{recursive:true});
    cpSync(join(source,'infra/azure-core/migration/deploy.mjs'),join(root,'infra/azure-core/migration/deploy.mjs'));
    cpSync(join(source,'infra/azure-core/archive-policy.mjs'),join(root,'infra/azure-core/archive-policy.mjs'));
    writeFileSync(join(root,'scripts/azure-core/snapshot.mjs'),'export const canonical=x=>x;export const snapshotReceipt=x=>x;');
    writeFileSync(join(root,'scripts/azure-core/configure-authenticator.mjs'),'export const authenticatorExpiry=()=>{};');
    writeFileSync(join(root,'infra/azure-core/preflight.mjs'),`import {readFileSync} from 'node:fs';export const policy={subscriptionId:'synthetic',resourceGroup:'synthetic'};export const scopePreflight=()=>{};export const migrationTargetChecks=()=>({vault:'vfakvabcdefghijklm',storage:'synthetic'});export const az=args=>{if(args[0]==='deployment')return{properties:{outputs:{postgresHost:{value:'synthetic.postgres.database.azure.com'}}}};if(args.includes('execution'))return[];const p=JSON.parse(readFileSync('build/azure-core/migration-job-parameters.json','utf8')).parameters;const env={AZURE_TARGET_HOST:p.postgresHost.value,MIGRATION_VAULT_HOST:p.vaultName.value+'.vault.azure.net',MIGRATION_ADMIN_SECRET_URL:'https://'+p.vaultName.value+'.vault.azure.net/secrets/migration-admin-uri',MIGRATION_PACKAGE_KEY_SECRET_URL:'https://'+p.vaultName.value+'.vault.azure.net/secrets/'+p.packageKeySecretName.value,MIGRATION_ACTION:p.migrationAction.value,MIGRATION_PACKAGE_SHA256:p.packageSha256.value,MIGRATION_PACKAGE_URL:'https://'+p.storageAccountName.value+'.blob.core.windows.net/migration-packages/'+p.packageBlobName.value,MIGRATION_RECEIPT_URL:'https://'+p.storageAccountName.value+'.blob.core.windows.net/migration-receipts/'+p.receiptBlobName.value};return{properties:{template:{containers:[{env:Object.entries(env).map(([name,value])=>({name,value}))}]}}};};`);
    writeFileSync(join(root,'bin/az'),`#!/usr/bin/env node\nrequire('node:fs').appendFileSync('fake-az-calls.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');`,{mode:0o700});
    writeFileSync(join(root,'bin/git'),`#!/usr/bin/env node\nif(process.env.TEST_GIT_UNAVAILABLE==='1')process.exit(1);const args=process.argv.slice(2);if(args.includes('--show-toplevel'))console.log(process.cwd());else if(args.includes('--porcelain=v1'))process.stdout.write(process.env.TEST_GIT_DIRTY==='1'?' M tracked.mjs\\n':'');else if(args.includes('HEAD^{tree}'))console.log(process.env.TEST_GIT_TREE||'${'2'.repeat(40)}');else if(args.includes('HEAD'))console.log(process.env.TEST_GIT_COMMIT||'${'1'.repeat(40)}');else process.exit(1);`,{mode:0o700});
    const payload=Buffer.from('synthetic encrypted artifact');const sha=createHash('sha256').update(payload).digest('hex');
    writeFileSync(join(root,'build/azure-core/private/fixture.enc'),payload);writeFileSync(join(root,'build/azure-core/private/migration-package-key.txt'),'synthetic-private-key');
    const receiptPath=join(root,'build/azure-core/migration-package-receipt.json');
    const cleanProvenance={sourceClean:true,sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40)};
    const putReceipt=(packageType,provenance=cleanProvenance)=>writeFileSync(receiptPath,JSON.stringify({packageType,sha256:sha,blobName:'fixture.enc',...provenance}));
    const run=(flags,{operation='--prepare',env={}}={})=>spawnSync(process.execPath,['infra/azure-core/migration/deploy.mjs',operation,...flags],{cwd:root,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,...env},encoding:'utf8'});
    putReceipt('forward');
    const names=new Set();
    for(const action of [...Object.keys(FORWARD_ACTIONS),'forward-plan']){
      const result=run([`--${action}`]);assert.equal(result.status,0,result.stderr);
      const parameters=JSON.parse(readFileSync(join(root,'build/azure-core/migration-job-parameters.json'),'utf8')).parameters;
      assert.equal(parameters.migrationAction.value,action);assert.match(parameters.receiptBlobName.value,new RegExp(`^${action}-${sha}-[0-9]+-[a-f0-9-]{36}\\.json$`));
      assert.equal(names.has(parameters.receiptBlobName.value),false);names.add(parameters.receiptBlobName.value);
    }
    for(const flags of [[],['--probe'],['--configure-authenticator'],['--map-identities'],['--final-sync'],['--forward-plan','--forward-schema']])assert.notEqual(run(flags).status,0);
    for(const action of ['forward-schema','forward-activate']){
      putReceipt('forward');assert.equal(run([`--${action}`]).status,0);assert.equal(run([`--${action}`],{operation:'--start'}).status,0);
      for(const operation of ['--prepare','--start']){
        for(const provenance of [{},{sourceClean:false,sourceCommit:null,sourceTree:null},{...cleanProvenance,sourceCommit:'3'.repeat(40)},{...cleanProvenance,sourceTree:'4'.repeat(40)}]){
          putReceipt('forward',provenance);const result=run([`--${action}`],{operation});assert.notEqual(result.status,0);assert.match(result.stderr,/matching clean committed source provenance/);
        }
        putReceipt('forward');
        for(const env of [{TEST_GIT_DIRTY:'1'},{TEST_GIT_UNAVAILABLE:'1'},{TEST_GIT_COMMIT:'3'.repeat(40)},{TEST_GIT_TREE:'4'.repeat(40)}]){
          const result=run([`--${action}`],{operation,env});assert.notEqual(result.status,0);assert.match(result.stderr,/matching clean committed source provenance/);
        }
      }
    }
    putReceipt('forward',{sourceClean:false,sourceCommit:null,sourceTree:null});
    for(const action of ['forward-plan','forward-activation-plan'])assert.equal(run([`--${action}`],{env:{TEST_GIT_DIRTY:'1'}}).status,0);
    putReceipt('schema-import');assert.notEqual(run(['--forward-plan']).status,0);
    const calls=readFileSync(join(root,'fake-az-calls.jsonl'),'utf8');assert.equal(calls.includes('synthetic-private-key'),false);assert.equal(calls.trim().split('\n').map(line=>JSON.parse(line)).filter(args=>args.slice(0,3).join(' ')==='containerapp job start').length,2);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('real forward packager relocates with all52 schema inputs and locked pg closure without any snapshot or DB',()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-forward-package-'));
  try{
    for(const path of ['scripts/azure-core','supabase/migrations','src/lib/identity','infra/azure-core/postgres-roots.crt']){
      mkdirSync(join(root,path,'..'),{recursive:true});cpSync(join(source,path),join(root,path),{recursive:true});
    }
    // Resolve installed dependencies for the packager; the archive itself must contain its own copies.
    writeFileSync(join(root,'package.json'),'{"type":"module"}');symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
    const privateDir=join(root,'build/azure-core/private');mkdirSync(privateDir,{recursive:true});
    for(const optional of [false,true]){
      if(optional){writeFileSync(join(privateDir,'forward-plan.json'),JSON.stringify(plan()));writeFileSync(join(privateDir,'forward-deployment-evidence.json'),JSON.stringify({rootVerifiedReady:true,reviewedSha:'d'.repeat(40),verifiedSha:'d'.repeat(40)}));}
      const packed=spawnSync(process.execPath,[join(source,'infra/azure-core/migration/package.mjs'),'--forward'],{cwd:root,env:archiveEnv,encoding:'utf8'});
      assert.equal(packed.status,0,packed.stderr);
      const receipt=JSON.parse(readFileSync(join(root,'build/azure-core/migration-package-receipt.json'),'utf8'));
      assert.equal(receipt.packageType,'forward');assert.equal(receipt.schemaSha256,buildAzureSchema({through:'20261105020000_teaching_permissions_activation.sql'}).receipt.schemaSha256);assert.ok(receipt.dependencies.pg);
      assert.equal(receipt.sourceClean,false);assert.equal(receipt.sourceCommit,null);assert.equal(receipt.sourceTree,null);
      const encrypted=readFileSync(join(privateDir,receipt.blobName));const key=Buffer.from(readFileSync(join(privateDir,'migration-package-key.txt'),'utf8'),'base64');
      const decrypt=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));decrypt.setAuthTag(encrypted.subarray(12,28));
      const archive=join(root,'inspect.tar.gz');writeFileSync(archive,Buffer.concat([decrypt.update(encrypted.subarray(28)),decrypt.final()]));key.fill(0);
      const version=execFileSync('tar',['--version'],{encoding:'utf8',env:archiveEnv});
      const listing=execFileSync('tar',tarListingArguments(archive,version),{encoding:'utf8',env:archiveEnv});rmSync(archive);
      assert.equal(listing.includes('source-snapshot.json'),false);assert.equal(listing.includes('scripts/azure-core/migrate.mjs'),false);
      assert.equal(listing.split('\n').filter(name=>/^\.\/supabase\/migrations\/[^/]+\.sql$/.test(name)).length,52);
      assert.equal(listing.includes('20261105030000_exam_attachment_bindings.sql'),false);
      assert.equal(listing.includes('forward-plan.json'),optional);assert.equal(listing.includes('forward-deployment-evidence.json'),optional);
      assert.equal(existsSync(join(privateDir,'source-snapshot.json')),false);
      const checked=spawnSync(process.execPath,[join(source,'infra/azure-core/migration/verify-package.mjs')],{cwd:root,env:{PATH:process.env.PATH,LC_ALL:'C'},encoding:'utf8'});
      assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/No cloud\/database connection opened/);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('actual bootstrap dispatches each fixed CLI mode, rejects private receipt fields and persists only safe failure metadata',()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-forward-job-'));
  const vault='vfakvabcdefghijklm.vault.azure.net',host='vfa-core-pg-abcdefghijklm.postgres.database.azure.com';
  try{
    mkdirSync(join(root,'scripts/azure-core'),{recursive:true});
    writeFileSync(join(root,'scripts/azure-core/forward-cli.mjs'),`
      const modes={'forward-plan':'plan-schema','forward-schema':'apply-schema','forward-activation-plan':'plan-activate','forward-activate':'apply-activate'};
      if(process.argv[2]!==modes[process.env.MIGRATION_ACTION]||process.env.IDENTITY_HEADER||!process.env.AZURE_DATABASE_URL.includes('NEVER_LOG_PASSWORD')||!process.env.NODE_EXTRA_CA_CERTS)throw Error('bad_transport');
      if(process.env.TEST_FORWARD_FAIL==='1'){console.error(JSON.stringify({errorCode:'FORWARD_FAILED',sqlState:'42501',message:'NEVER_LOG_PRIVATE_SQL'}));process.exit(1);}
      console.log(process.env.TEST_FORWARD_RECEIPT);
    `);
    mkdirSync(join(root,'infra/azure-core'),{recursive:true});cpSync(join(source,'infra/azure-core/postgres-roots.crt'),join(root,'infra/azure-core/postgres-roots.crt'));
    const archive=join(root,'../'+root.split('/').at(-1)+'.tar.gz');execFileSync('tar',['-czf',archive,'-C',root,'.'],{env:archiveEnv});
    const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
    const encrypted=Buffer.concat([nonce,Buffer.alloc(16),cipher.update(readFileSync(archive)),cipher.final()]);cipher.getAuthTag().copy(encrypted,12);rmSync(archive);
    const sha=createHash('sha256').update(encrypted).digest('hex');
    const run=(action,receipt,fail=false)=>{
      const mock=`globalThis.fetch=async(url,options)=>{const u=new URL(String(url));if(u.origin==='http://identity')return{ok:true,json:async()=>({access_token:'NEVER_LOG_TOKEN'})};if(u.hostname==='${vault}')return{status:200,json:async()=>({value:u.pathname.includes('/migration-key-')?'${key.toString('base64')}':'postgresql://academy_admin:NEVER_LOG_PASSWORD@${host}/academy?sslmode=verify-full'})};if(u.hostname!=='example.blob.core.windows.net')throw Error('unexpected_network');if(options?.method==='PUT'){if(options.headers['If-None-Match']!=='*')throw Error('mutable_receipt');const body=Buffer.from(options.body).toString();if(body.includes('NEVER_LOG')||body.includes('rows'))throw Error('private_receipt');console.log('RECEIPT '+body);return{ok:true};}return{ok:true,arrayBuffer:async()=>Buffer.from('${encrypted.toString('base64')}','base64')};};\n`;
      return spawnSync(process.execPath,['--input-type=module','-e',mock+readFileSync(join(source,'infra/azure-core/archive-policy.mjs'),'utf8')+'\n'+readFileSync(join(source,'infra/azure-core/migration/bootstrap.mjs'),'utf8')],{encoding:'utf8',env:{...archiveEnv,MIGRATION_ACTION:action,IDENTITY_ENDPOINT:'http://identity/',IDENTITY_HEADER:'NEVER_LOG_IDENTITY',AZURE_CLIENT_ID:'mock',AZURE_TARGET_HOST:host,MIGRATION_VAULT_HOST:vault,MIGRATION_ADMIN_SECRET_URL:`https://${vault}/secrets/migration-admin-uri`,MIGRATION_PACKAGE_KEY_SECRET_URL:`https://${vault}/secrets/migration-key-${sha.slice(0,16)}`,MIGRATION_PACKAGE_URL:'https://example.blob.core.windows.net/migration-packages/test.enc',MIGRATION_PACKAGE_SHA256:sha,MIGRATION_RECEIPT_URL:'https://example.blob.core.windows.net/migration-receipts/test.json',TEST_FORWARD_RECEIPT:JSON.stringify(receipt),TEST_FORWARD_FAIL:fail?'1':'0'}});
    };
    for(const [action,receipt] of [['forward-plan',plan()],['forward-schema',{action:'forward-schema',phase:'schema',receiptCount:2,outcome:'applied'}],['forward-activation-plan',plan('activate',2)],['forward-activate',{action:'forward-activate',phase:'activate',receiptCount:3,outcome:'noop'}]]){
      const result=run(action,receipt);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/forward_action_completed/);assert.match(result.stdout,/RECEIPT /);assert.equal((result.stdout+result.stderr).includes('NEVER_LOG'),false);
    }
    const invalid=run('forward-plan',{...plan(),rows:['NEVER_LOG_PRIVATE_ROW']});assert.equal(invalid.status,1);assert.equal(JSON.parse(invalid.stderr).stage,'forward_action');assert.equal((invalid.stdout+invalid.stderr).includes('NEVER_LOG'),false);
    const failed=run('forward-schema',null,true);const diagnostic=JSON.parse(failed.stderr);assert.equal(failed.status,1);assert.equal(diagnostic.stage,'forward_action');assert.equal(diagnostic.childErrorCode,'FORWARD_FAILED');assert.equal(diagnostic.sqlState,'42501');assert.equal(diagnostic.failureReceiptPersisted,true);assert.equal((failed.stdout+failed.stderr).includes('NEVER_LOG'),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

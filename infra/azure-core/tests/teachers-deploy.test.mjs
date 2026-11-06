import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';

const source=fileURLToPath(new URL('../../../',import.meta.url));
const commit='1'.repeat(40),tree='2'.repeat(40),activation='3'.repeat(40);
const hash=value=>createHash('sha256').update(value).digest('hex');
const release=buildAzureSchema({through:'20261106040000_management_teaching_scope.sql'}).receipt.migrations.slice(54);
const artifact=release[0];
const old=buildAzureSchema({through:'20261106000000_managed_profile_handles.sql'}).receipt.migrations[53];
const predecessor={filename:old.file,source_sha256:old.sourceSha256,azure_sha256:old.azureSha256,identity_sha256:hash(readFileSync(join(source,'scripts/azure-core/baselines/identity-post-handles.sql'))),source_commit:'b'.repeat(40),source_tree:'c'.repeat(40)};
const provenance={sourceClean:true,sourceCommit:commit,sourceTree:tree};
function reviewPlan(content='4'.repeat(64)) {
  return {action:'forward-55-plan',source:provenance,packageContentSha256:content,plan:{
    action:'apply',filename:artifact.file,sourceSha256:artifact.sourceSha256,azureSha256:artifact.azureSha256,identitySha256:hash(readFileSync(join(source,'src/lib/identity/schema.sql'))),migrations:release,predecessor,
    baseline:'273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149',activationSha:activation,
    priorReceiptDigest:'5'.repeat(64),roleCount:3,roleDigest:'6'.repeat(64),teacherCutoverInventory:{ordinaryActorCount:0,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:false},source:provenance,
  }};
}

/** The real deploy script runs in a disposable checkout with only synthetic provider/identity fixtures. */
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'academy-teachers-deploy-'));
  for(const path of ['infra/azure-core/migration','scripts','supabase','src/lib','build/azure-core/private','bin'])mkdirSync(join(root,path),{recursive:true});
  for(const path of ['infra/azure-core/migration/deploy.mjs','infra/azure-core/migration/bootstrap.mjs','infra/azure-core/archive-policy.mjs','infra/azure-core/migration-job.bicep','infra/azure-core/postgres-roots.crt','scripts/azure-core','supabase/migrations','src/lib/identity','package.json','package-lock.json']){
    mkdirSync(join(root,path,'..'),{recursive:true});cpSync(join(source,path),join(root,path),{recursive:true});
  }
  // These two unrelated V1 imports are not used by 54; the lazy 54 package
  // helper and its complete fixed schema/provenance closure remain real.
  writeFileSync(join(root,'scripts/azure-core/snapshot.mjs'),'export const canonical=x=>x;export const snapshotReceipt=x=>x;');
  writeFileSync(join(root,'scripts/azure-core/configure-authenticator.mjs'),'export const authenticatorExpiry=()=>{};');
  writeFileSync(join(root,'infra/azure-core/preflight.mjs'),`
    import {appendFileSync,readFileSync} from 'node:fs';
    const log=x=>appendFileSync('fake-preflight.jsonl',JSON.stringify(x)+'\\n');
    export const policy={subscriptionId:'synthetic',resourceGroup:'synthetic'};
    export const scopePreflight=()=>log(['scope']);
    export const migrationTargetChecks=()=>({vault:'vfakvabcdefghijklm',storage:'synthetic'});
    export const az=args=>{
      log(args);
      if(args[0]==='identity')return{id:args[args.indexOf('--ids')+1],clientId:'99999999-9999-4999-8999-999999999999'};
      if(args[0]==='deployment')return{properties:{outputs:{postgresHost:{value:'fixture.postgres.database.azure.com'}}}};
      if(args.includes('execution'))return[];
      const p=JSON.parse(readFileSync('build/azure-core/migration-job-parameters.json','utf8')).parameters;
      const env={MIGRATION_ACTION:p.migrationAction.value,AZURE_CLIENT_ID:'99999999-9999-4999-8999-999999999999',AZURE_TARGET_HOST:p.postgresHost.value,
        MIGRATION_VAULT_HOST:p.vaultName.value+'.vault.azure.net',MIGRATION_ADMIN_SECRET_URL:'https://'+p.vaultName.value+'.vault.azure.net/secrets/migration-admin-uri',
        MIGRATION_PACKAGE_KEY_SECRET_URL:'https://'+p.vaultName.value+'.vault.azure.net/secrets/'+p.packageKeySecretName.value,
        MIGRATION_PACKAGE_URL:'https://'+p.storageAccountName.value+'.blob.core.windows.net/migration-packages/'+p.packageBlobName.value,
        MIGRATION_PACKAGE_SHA256:p.packageSha256.value,MIGRATION_RECEIPT_URL:'https://'+p.storageAccountName.value+'.blob.core.windows.net/migration-receipts/'+p.receiptBlobName.value,
        MIGRATION_SOURCE_MANIFEST_SHA256:p.sourceManifestSha256.value,MIGRATION_PACKAGE_CONTENT_SHA256:p.packageContentSha256.value,
        MIGRATION_SOURCE_COMMIT:p.sourceCommit.value,MIGRATION_SOURCE_TREE:p.sourceTree.value};
      const image=/image: '([^']+)'/.exec(readFileSync('infra/azure-core/migration-job.bicep','utf8'))[1];
      const bootstrap=readFileSync('infra/azure-core/archive-policy.mjs','utf8')+'\\n'+readFileSync('infra/azure-core/migration/bootstrap.mjs','utf8');
      const container={image,command:['node'],args:['--input-type=module','-e',bootstrap],env:Object.entries(env).map(([name,value])=>({name,value}))};
      const change=process.env.TEST_JOB_CHANGE;
      if(change==='image')container.image='unreviewed:image';
      if(change==='command')container.command=['sh'];
      if(change==='bootstrap')container.args=['--input-type=module','-e','unreviewed'];
      if(change==='extra')container.env.push({name:'UNEXPECTED',value:'1'});
      if(change==='duplicate')container.env.push({...container.env[0]});
      if(change==='secretref')container.env[0]={name:'MIGRATION_ACTION',secretRef:'unexpected'};
      const mapping={action:'MIGRATION_ACTION',client:'AZURE_CLIENT_ID',target:'AZURE_TARGET_HOST',vault:'MIGRATION_VAULT_HOST',admin:'MIGRATION_ADMIN_SECRET_URL',key:'MIGRATION_PACKAGE_KEY_SECRET_URL',url:'MIGRATION_PACKAGE_URL',receipt:'MIGRATION_RECEIPT_URL',package:'MIGRATION_PACKAGE_SHA256',manifest:'MIGRATION_SOURCE_MANIFEST_SHA256',content:'MIGRATION_PACKAGE_CONTENT_SHA256',commit:'MIGRATION_SOURCE_COMMIT',tree:'MIGRATION_SOURCE_TREE'};
      if(mapping[change])container.env.find(entry=>entry.name===mapping[change]).value='changed';
      return{identity:{type:'UserAssigned',userAssignedIdentities:{'/subscriptions/synthetic/resourceGroups/synthetic/providers/Microsoft.ManagedIdentity/userAssignedIdentities/vfa-core-migration-identity':{}}},properties:{template:{containers:[container]}}};
    };`);
  writeFileSync(join(root,'bin/git'),`#!/usr/bin/env node
    if(process.env.TEST_GIT_UNAVAILABLE==='1')process.exit(1);
    const args=process.argv.slice(2);
    if(args.includes('--show-toplevel'))console.log(process.cwd());
    else if(args.includes('--porcelain=v1'))process.stdout.write(process.env.TEST_GIT_DIRTY==='1'?' M tracked.mjs\\n':'');
    else if(args.includes('HEAD^{tree}'))console.log(process.env.TEST_GIT_TREE||'${tree}');
    else if(args.includes('HEAD'))console.log(process.env.TEST_GIT_COMMIT||'${commit}');
    else process.exit(1);`,{mode:0o700});
  writeFileSync(join(root,'bin/az'),`#!/usr/bin/env node
    const fs=require('node:fs');const args=process.argv.slice(2);
    fs.appendFileSync('fake-az-calls.jsonl',JSON.stringify(args)+'\\n');
    if(args[0]==='storage'&&args[1]==='blob'&&args[2]==='download'){
      if(!process.env.TEST_RECEIPT)process.exit(1);
      fs.writeFileSync(args[args.indexOf('--file')+1],process.env.TEST_RECEIPT);
    }`,{mode:0o700});
  const payload=Buffer.from('synthetic-encrypted-fixture'),sha=hash(payload),content='4'.repeat(64);
  writeFileSync(join(root,'build/azure-core/private/fixture.enc'),payload);
  writeFileSync(join(root,'build/azure-core/private/migration-package-key.txt'),'SYNTHETIC_PRIVATE_FIXTURE_KEY',{mode:0o600});
  writeFileSync(join(root,'build/azure-core/private/forward-55-v1-evidence.json'),JSON.stringify({verified:true,activationSha:activation,predecessor}));
  const planPath=join(root,'build/azure-core/private/forward-55-plan.json');
  const manifestPath=join(root,'build/azure-core/private/forward-55-source-manifest.json');
  const receiptPath=join(root,'build/azure-core/migration-package-receipt.json');
  let currentPlan=reviewPlan(content);
  function writeState({packageType='forward-55',manifestChange={},receiptChange={},plan=currentPlan}={}){
    currentPlan=plan;
    const planBytes=Buffer.from(JSON.stringify(plan));writeFileSync(planPath,planBytes);
    const manifest={source:provenance,contentSha256:content,reviewedPlanSha256:hash(planBytes),...manifestChange};
    const manifestBytes=Buffer.from(JSON.stringify(manifest));writeFileSync(manifestPath,manifestBytes);
    const receipt={packageType,blobName:'fixture.enc',sha256:sha,...provenance,packageContentSha256:content,sourceManifestSha256:hash(manifestBytes),reviewedPlanSha256:hash(planBytes),...receiptChange};
    writeFileSync(receiptPath,JSON.stringify(receipt));return {receipt,manifest,plan};
  }
  function run(operation,action,extra={}){
    return spawnSync(process.execPath,['infra/azure-core/migration/deploy.mjs',operation,`--${action}`],{
      cwd:root,encoding:'utf8',env:{PATH:join(root,'bin')+':'+(process.env.PATH??''),LC_ALL:'C',...extra},
    });
  }
  function clearCalls(){for(const path of ['fake-preflight.jsonl','fake-az-calls.jsonl'])rmSync(join(root,path),{force:true});}
  function calls(path){return existsSync(join(root,path))?readFileSync(join(root,path),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];}
  return {root,sha,content,planPath,manifestPath,receiptPath,writeState,run,clearCalls,calls,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('actual teachers deploy prepares distinct immutable destinations and starts both exact reviewed actions',()=>{
  const f=fixture();try{
    const names=new Set();
    for(const action of ['forward-55-plan','forward-55-apply','forward-55-plan']){
      f.writeState();const prepared=f.run('--prepare',action);assert.equal(prepared.status,0,prepared.stderr);
      const params=JSON.parse(readFileSync(join(f.root,'build/azure-core/migration-job-parameters.json'),'utf8')).parameters;
      assert.equal(params.migrationAction.value,action);
      assert.match(params.receiptBlobName.value,new RegExp(`^${action}-${f.sha}-[0-9]+-[a-f0-9-]{36}\\.json$`));
      assert.equal(names.has(params.receiptBlobName.value),false);names.add(params.receiptBlobName.value);
      const started=f.run('--start',action);assert.equal(started.status,0,started.stderr);
    }
    const calls=f.calls('fake-az-calls.jsonl');
    assert.equal(calls.filter(args=>args.slice(0,3).join(' ')==='containerapp job start').length,3);
    assert.equal(JSON.stringify(calls).includes('SYNTHETIC_PRIVATE_FIXTURE_KEY'),false);
  }finally{f.cleanup();}
});

test('teachers prepare and start reject dirty, missing or stale source before any provider call',()=>{
  const f=fixture();try{
    for(const action of ['forward-55-plan','forward-55-apply'])for(const operation of ['--prepare','--start']){
      for(const env of [{TEST_GIT_DIRTY:'1'},{TEST_GIT_UNAVAILABLE:'1'},{TEST_GIT_COMMIT:'7'.repeat(40)},{TEST_GIT_TREE:'8'.repeat(40)}]){
        f.writeState();f.clearCalls();const result=f.run(operation,action,env);
        assert.notEqual(result.status,0);assert.match(result.stderr,/matching clean committed source provenance/);
        assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);assert.deepEqual(f.calls('fake-az-calls.jsonl'),[]);
      }
      for(const sourceChange of [{sourceClean:false,sourceCommit:null,sourceTree:null},{sourceClean:true,sourceCommit:'7'.repeat(40),sourceTree:tree},{sourceClean:true,sourceCommit:commit,sourceTree:'8'.repeat(40)}]){
        f.writeState({receiptChange:sourceChange});f.clearCalls();const result=f.run(operation,action);
        assert.notEqual(result.status,0);assert.match(result.stderr,/matching clean committed source provenance/);
        assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);assert.deepEqual(f.calls('fake-az-calls.jsonl'),[]);
      }
    }
  }finally{f.cleanup();}
});

test('teachers package, reviewed plan and source manifest must remain exactly bound before provider calls',()=>{
  const f=fixture();try{
    for(const action of ['forward-55-plan','forward-55-apply']){
      for(const changes of [
        {packageType:'forward'},
        {receiptChange:{sourceManifestSha256:'0'.repeat(64)}},
        {receiptChange:{packageContentSha256:'0'.repeat(64)}},
        {manifestChange:{source:{...provenance,sourceTree:'9'.repeat(40)}}},
      ]){
        f.writeState(changes);f.clearCalls();const result=f.run('--prepare',action);
        assert.notEqual(result.status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);assert.deepEqual(f.calls('fake-az-calls.jsonl'),[]);
      }
    }
    f.writeState();writeFileSync(f.planPath,JSON.stringify({...reviewPlan(),privateRows:['SYNTHETIC_PRIVATE_ROW']}));f.clearCalls();
    assert.notEqual(f.run('--prepare','forward-55-apply').status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);
    f.writeState({plan:{...reviewPlan(),privateRows:['SYNTHETIC_PRIVATE_ROW']}});f.clearCalls();
    const privatePlan=f.run('--prepare','forward-55-apply');assert.notEqual(privatePlan.status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);
    assert.equal((privatePlan.stdout+privatePlan.stderr).includes('SYNTHETIC_PRIVATE_ROW'),false);
    f.writeState({manifestChange:{reviewedPlanSha256:'0'.repeat(64)}});f.clearCalls();
    assert.notEqual(f.run('--prepare','forward-55-apply').status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);
    for(const mutate of [plan=>{plan.plan.migrations=plan.plan.migrations.slice(0,3);},plan=>{plan.plan.migrations=[...plan.plan.migrations].reverse();},plan=>{plan.plan.predecessor={...predecessor,source_commit:'d'.repeat(40)};},plan=>{plan.plan.identitySha256='0'.repeat(64);}]){const invalid=structuredClone(reviewPlan());mutate(invalid);f.writeState({plan:invalid});f.clearCalls();assert.notEqual(f.run('--prepare','forward-55-apply').status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);}
    const changed=reviewPlan();changed.plan.azureSha256='0'.repeat(64);f.writeState({plan:changed});f.clearCalls();
    assert.notEqual(f.run('--prepare','forward-55-apply').status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);
    f.writeState({plan:reviewPlan()});writeFileSync(join(f.root,'build/azure-core/private/forward-55-v1-evidence.json'),JSON.stringify({verified:true,activationSha:'b'.repeat(40)}));f.clearCalls();
    assert.notEqual(f.run('--prepare','forward-55-apply').status,0);assert.deepEqual(f.calls('fake-preflight.jsonl'),[]);
    f.writeState({receiptChange:{sha256:'0'.repeat(64)},plan:reviewPlan()});f.clearCalls();
    const changedArchive=f.run('--prepare','forward-55-plan');assert.notEqual(changedArchive.status,0);
    assert.match(changedArchive.stderr,/Encrypted package does not match receipt/);
    assert.deepEqual(f.calls('fake-az-calls.jsonl'),[]);
  }finally{f.cleanup();}
});

test('start rejects changed image, command, bootstrap, action, target, proof or extra environment before starting the job',()=>{
  const f=fixture();try{
    for(const change of ['image','command','bootstrap','action','client','target','vault','admin','key','url','receipt','package','manifest','content','commit','tree','extra','duplicate','secretref']){
      f.writeState();assert.equal(f.run('--prepare','forward-55-plan').status,0);f.clearCalls();
      const result=f.run('--start','forward-55-plan',{TEST_JOB_CHANGE:change});assert.notEqual(result.status,0,change);
      assert.equal(f.calls('fake-az-calls.jsonl').some(args=>args.slice(0,3).join(' ')==='containerapp job start'),false,change);
    }
    f.writeState();assert.equal(f.run('--prepare','forward-55-plan').status,0);f.clearCalls();
    assert.notEqual(f.run('--start','forward-55-apply').status,0);
    assert.equal(f.calls('fake-az-calls.jsonl').some(args=>args.slice(0,3).join(' ')==='containerapp job start'),false);
  }finally{f.cleanup();}
});

test('receipt checks accept exact package-bound metadata and reject changed hashes or private fields',()=>{
  const f=fixture();try{
    for(const action of ['forward-55-plan','forward-55-apply']){
      const {receipt,plan}=f.writeState();assert.equal(f.run('--prepare',action).status,0);
      const transport={source:provenance,packageContentSha256:receipt.packageContentSha256,encryptedPackageSha256:receipt.sha256,sourceManifestSha256:receipt.sourceManifestSha256};
      const output=action==='forward-55-plan'?{...plan,...transport}:{action:'forward-55-apply',outcome:'applied',filename:artifact.file,...transport};
      assert.equal(f.run('--receipt',action,{TEST_RECEIPT:JSON.stringify(output)}).status,0);
      for(const altered of [{...output,encryptedPackageSha256:'0'.repeat(64)},{...output,sourceManifestSha256:'0'.repeat(64)},{...output,packageContentSha256:'0'.repeat(64)},{...output,source:{...provenance,sourceCommit:'0'.repeat(40)}},{...output,rows:[{email:'SYNTHETIC_PRIVATE_ROW'}]}]){
        const result=f.run('--receipt',action,{TEST_RECEIPT:JSON.stringify(altered)});assert.notEqual(result.status,0);
        assert.equal((result.stdout+result.stderr).includes('SYNTHETIC_PRIVATE_ROW'),false);
      }
    }
  }finally{f.cleanup();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync,spawnSync } from 'node:child_process';
import { randomBytes,createCipheriv,createHash } from 'node:crypto';
import { validateParameters } from '../preflight.mjs';
test('base parameters require no fake Entra IDs and fail if prematurely enabling API without credentials',()=>{
  const p={parameters:Object.fromEntries(Object.entries({postgresAdminPassword:'x'.repeat(32),cronSecret:'y'.repeat(32),emailDedupeSecret:'z'.repeat(32),budgetStartDate:'2026-11-01T00:00:00Z'}).map(([k,value])=>[k,{value}]))};
  assert.equal(validateParameters(p,{base:true}),true);
  p.parameters.deployPostgrest={value:true};assert.throws(()=>validateParameters(p,{base:true}));
});
test('runtime managed-identity secrets, target guard, encrypted package and sanitized failures',()=>{
  const folder=mkdtempSync(join(tmpdir(),'academy-job-test-'));
  const vaultHost='vfakvabcdefghijklm.vault.azure.net';
  const targetHost='vfa-core-pg-abcdefghijklm.postgres.database.azure.com';
  const adminUri=`postgresql://academy_admin:NEVER_LOG_DB_PASSWORD@${targetHost}/academy?sslmode=verify-full`;
  try{
    mkdirSync(join(folder,'scripts/azure-core'),{recursive:true});mkdirSync(join(folder,'infra/azure-core/migration'),{recursive:true});
    writeFileSync(join(folder,'infra/azure-core/postgres-roots.crt'),readFileSync('infra/azure-core/postgres-roots.crt'));
    writeFileSync(join(folder,'scripts/azure-core/migrate.mjs'),"import {mkdirSync,writeFileSync} from 'node:fs';if(!process.env.AZURE_DATABASE_URL.includes('NEVER_LOG_DB_PASSWORD')||!process.env.AZURE_TARGET_HOST||process.env.MIGRATION_PACKAGE_KEY)throw Error('bad_child_environment');if(process.env.TEST_FAIL_SCHEMA==='1'){console.error(JSON.stringify({errorCode:'MIGRATION_FAILED',sqlState:'42501',schemaStep:process.env.TEST_SCHEMA_STEP,position:JSON.parse(process.env.TEST_SCHEMA_POSITION),message:'NEVER_LOG_PRIVATE_SQL_VALUE'}));process.exit(1);}if(process.argv[2]==='import'){mkdirSync('build/azure-core',{recursive:true});writeFileSync('build/azure-core/target-reconciliation.json',JSON.stringify({tables:{profiles:{rows:2,sha256:'test'}}}));}");
    writeFileSync(join(folder,'scripts/azure-core/schema.mjs'),"export const azureSchemaStepNames=()=>['bootstrap.sql','supabase/migrations/0001_initial.sql','storage.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','media-delete.sql','account-access.sql'];");
    writeFileSync(join(folder,'scripts/azure-core/configure-authenticator.mjs'),"if(process.env.AZURE_AUTHENTICATOR_PASSWORD!=='NEVER_LOG_AUTH_PASSWORD'||process.env.MIGRATION_PACKAGE_KEY)throw Error('bad_child_environment');console.log(JSON.stringify({role:'academy_authenticator',expiresAt:process.env.AZURE_AUTHENTICATOR_EXPIRES_AT}));");
    writeFileSync(join(folder,'infra/azure-core/migration/probe.mjs'),"console.log(JSON.stringify({action:'probe',readOnly:true,counts:{users:0}}));");
    const archive=join(folder,'../'+folder.split('/').at(-1)+'.tar.gz');
    execFileSync('tar',['-czf',archive,'-C',folder,'.'],{env:{...process.env,LC_ALL:'C',COPYFILE_DISABLE:'1'}});
    const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
    const content=Buffer.concat([cipher.update(readFileSync(archive)),cipher.final()]);rmSync(archive);
    const encrypted=Buffer.concat([nonce,cipher.getAuthTag(),content]);
    const run=(payload,{failChild=false,action='schema-import',kvMode='ok',keyUrl,uri=adminUri,schemaStep='bootstrap.sql',position=42}={})=>{
      const sha=createHash('sha256').update(payload).digest('hex');
      const mock=`let keyCalls=0;globalThis.fetch=async function(url,options){const u=new URL(String(url));if(u.origin==='http://identity'){const resource=u.searchParams.get('resource');if(resource==='https://storage.azure.com/')return {ok:true,json:async()=>({access_token:'mock-storage-token'})};if(resource==='https://vault.azure.net')return {ok:true,json:async()=>({access_token:'mock-vault-token'})};throw Error('bad_resource');}if(u.hostname==='${vaultHost}'){if(options.redirect!=='manual'||options.headers.Authorization!=='Bearer mock-vault-token'||u.searchParams.get('api-version')!=='2025-07-01')throw Error('unsafe_kv_request');if(u.pathname.includes('/migration-key-')){keyCalls++;if('${kvMode}'==='forbidden'||('${kvMode}'==='propagate'&&keyCalls<3))return{status:403};if('${kvMode}'==='redirect')return{status:302};return{status:200,json:async()=>({value:'${key.toString('base64')}'})};}if(u.pathname==='/secrets/migration-admin-uri')return{status:200,json:async()=>({value:${JSON.stringify(uri)}})};if(u.pathname==='/secrets/postgrest-authenticator-password'&&'${action}'==='configure-authenticator')return{status:200,json:async()=>({value:'NEVER_LOG_AUTH_PASSWORD'})};throw Error('unexpected_secret');}if(u.hostname!=='example.blob.core.windows.net')throw Error('unapproved_network_target');if(options?.method==='PUT'){const data=JSON.parse(Buffer.from(options.body).toString());if(data.status==='failed'){if(data.message||data.sql||data.rows||data.env||JSON.stringify(data).includes('NEVER_LOG'))throw Error('unsafe_failure_receipt');return{ok:true};}if(data.action==='probe'){if(data.readOnly!==true)throw Error('bad_probe');}else if(data.role!=='academy_authenticator'&&(!data.tables.profiles||data.password))throw Error('bad_receipt');return{ok:true};}return{ok:true,arrayBuffer:async()=>Buffer.from('${payload.toString('base64')}','base64')};};\n`;
      return spawnSync(process.execPath,['--input-type=module','-e',mock+readFileSync('infra/azure-core/archive-policy.mjs','utf8')+'\n'+readFileSync('infra/azure-core/migration/bootstrap.mjs','utf8')],{encoding:'utf8',env:{...process.env,TEST_FAIL_SCHEMA:failChild?'1':'0',TEST_SCHEMA_STEP:schemaStep,TEST_SCHEMA_POSITION:JSON.stringify(position),MIGRATION_ACTION:action,IDENTITY_ENDPOINT:'http://identity/',IDENTITY_HEADER:'mock',AZURE_CLIENT_ID:'mock',AZURE_TARGET_HOST:targetHost,MIGRATION_VAULT_HOST:vaultHost,MIGRATION_ADMIN_SECRET_URL:`https://${vaultHost}/secrets/migration-admin-uri`,MIGRATION_PACKAGE_KEY_SECRET_URL:keyUrl??`https://${vaultHost}/secrets/migration-key-${sha.slice(0,16)}`,MIGRATION_AUTHENTICATOR_SECRET_URL:`https://${vaultHost}/secrets/postgrest-authenticator-password`,AZURE_AUTHENTICATOR_EXPIRES_AT:'2099-01-01T00:00:00Z',MIGRATION_PACKAGE_URL:'https://example.blob.core.windows.net/migration-packages/test.enc',MIGRATION_RECEIPT_URL:'https://example.blob.core.windows.net/migration-receipts/test.json',MIGRATION_PACKAGE_SHA256:sha}});
    };
    const result=run(encrypted,{kvMode:'propagate'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).status,'schema_and_import_reconciled');
    for(const value of [key.toString('base64'),adminUri,'NEVER_LOG_DB_PASSWORD','mock-vault-token'])assert.equal((result.stdout+result.stderr).includes(value),false);
    const configured=run(encrypted,{action:'configure-authenticator'});assert.equal(configured.status,0,configured.stderr);assert.equal((configured.stdout+configured.stderr).includes('NEVER_LOG_AUTH_PASSWORD'),false);
    const probed=run(encrypted,{failChild:true,action:'probe'});
    assert.equal(probed.status,0,probed.stderr);assert.equal(JSON.parse(probed.stdout.trim().split('\n').at(-1)).status,'target_probed');assert.equal(probed.stdout.includes('apply_schema'),false);
    const childFailed=run(encrypted,{failChild:true});
    assert.equal(childFailed.status,1);assert.equal(JSON.parse(childFailed.stderr).stage,'apply_schema');assert.equal(JSON.parse(childFailed.stderr).sqlState,'42501');assert.equal(JSON.parse(childFailed.stderr).schemaStep,'bootstrap.sql');assert.equal(JSON.parse(childFailed.stderr).position,42);assert.equal(JSON.parse(childFailed.stderr).failureReceiptPersisted,true);assert.equal(childFailed.stderr.includes('NEVER_LOG_PRIVATE_SQL_VALUE'),false);
    for(const [schemaStep,position] of [['NEVER_LOG_PRIVATE_SQL_VALUE','NEVER_LOG_PRIVATE_SQL_VALUE'],['../outside.sql',-1],['/secret/file.sql',1.5],['unlisted.sql',Number.MAX_SAFE_INTEGER+1]]){const rejected=run(encrypted,{failChild:true,schemaStep,position});const diagnostic=JSON.parse(rejected.stderr);assert.equal(diagnostic.schemaStep,undefined);assert.equal(diagnostic.position,undefined);assert.equal((rejected.stdout+rejected.stderr).includes('NEVER_LOG_PRIVATE_SQL_VALUE'),false);}
    const forbidden=run(encrypted,{kvMode:'forbidden'});const failure=JSON.parse(forbidden.stderr);
    assert.equal(forbidden.status,1);assert.equal(failure.stage,'fetch_package_key');assert.equal(failure.httpStatus,403);assert.equal(failure.secretAttempts,5);assert.equal(failure.failureReceiptPersisted,true);assert.equal(forbidden.stdout.includes('apply_schema'),false);
    const redirected=run(encrypted,{kvMode:'redirect'});assert.equal(JSON.parse(redirected.stderr).httpStatus,302);assert.equal(JSON.parse(redirected.stderr).secretAttempts,1);
    for(const keyUrl of ['https://evil.example/secrets/key',`https://user@${vaultHost}/secrets/key`,`https://${vaultHost}/secrets/key?api-version=7.4`,`https://${vaultHost}/secrets/key#x`]){const bad=run(encrypted,{keyUrl});assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stderr).stage,'validate_key_vault_urls');assert.equal(JSON.parse(bad.stderr).failureReceiptPersisted,true);}
    for(const uri of [adminUri.replace(targetHost,'other.postgres.database.azure.com'),adminUri.replace('/academy?','/other?'),adminUri+'&host=other.postgres.database.azure.com']){const bad=run(encrypted,{uri});assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stderr).stage,'validate_database_target');assert.equal(bad.stdout.includes('apply_schema'),false);assert.equal((bad.stdout+bad.stderr).includes('NEVER_LOG_DB_PASSWORD'),false);}
    mkdirSync(join(folder,'supabase/migrations'),{recursive:true});writeFileSync(join(folder,'supabase/migrations/._0001_identity.sql'),'synthetic AppleDouble metadata');
    execFileSync('tar',['-czf',archive,'-C',folder,'.'],{env:{...process.env,LC_ALL:'C',COPYFILE_DISABLE:'1'}});
    const badNonce=randomBytes(12),badCipher=createCipheriv('aes-256-gcm',key,badNonce),badBody=Buffer.concat([badCipher.update(readFileSync(archive)),badCipher.final()]);rmSync(archive);
    const invalid=run(Buffer.concat([badNonce,badCipher.getAuthTag(),badBody]));
    assert.equal(invalid.status,1);assert.equal(JSON.parse(invalid.stderr).stage,'validate_archive');assert.equal(JSON.parse(invalid.stderr).failureReceiptPersisted,true);assert.equal(invalid.stdout.includes('apply_schema'),false);assert.equal(invalid.stdout.includes('\"stage\":\"extract_package\"'),false);assert.equal(invalid.stdout.includes('fetch_admin_uri'),false);
    const corrupt=Buffer.from(encrypted);corrupt[30]^=1;const failed=run(corrupt);
    assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).stage,'decrypt_package');assert.equal(JSON.parse(failed.stderr).failureReceiptPersisted,true);assert.equal(failed.stderr.includes(key.toString('base64')),false);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

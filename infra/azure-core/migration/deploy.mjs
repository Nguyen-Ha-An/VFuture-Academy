import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,statSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { canonical,snapshotReceipt } from '../../../scripts/azure-core/snapshot.mjs';
import { authenticatorExpiry } from '../../../scripts/azure-core/configure-authenticator.mjs';
import { az,policy,scopePreflight,migrationTargetChecks } from '../preflight.mjs';
import { FORWARD_ACTIONS,validateForwardReceipt } from '../archive-policy.mjs';
const action=process.argv[2];
const configureAuthenticator=process.argv.includes('--configure-authenticator');
const probe=process.argv.includes('--probe');
const cutover=process.argv.includes('--map-identities')?'map-identities':process.argv.includes('--final-sync')?'final-sync':null;
const forward=Object.keys(FORWARD_ACTIONS).find(name=>process.argv.includes(`--${name}`));
if([probe,configureAuthenticator,process.argv.includes('--map-identities'),process.argv.includes('--final-sync'),...Object.keys(FORWARD_ACTIONS).map(name=>process.argv.includes(`--${name}`))].filter(Boolean).length>1)throw new Error('Choose only one job action');
const requestedAction=forward??cutover??(probe?'probe':configureAuthenticator?'configure-authenticator':'schema-import');
if(!['--prepare','--start','--receipt'].includes(action))throw new Error('Usage: node infra/azure-core/migration/deploy.mjs --prepare|--start|--receipt');
let forwardApplyReceipt;
if(['forward-schema','forward-activate'].includes(forward)&&['--prepare','--start'].includes(action)){
  forwardApplyReceipt=JSON.parse(readFileSync('build/azure-core/migration-package-receipt.json','utf8'));
  try{
    const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(forwardApplyReceipt.sourceClean!==true||!/^[a-f0-9]{40}$/.test(forwardApplyReceipt.sourceCommit??'')||!/^[a-f0-9]{40}$/.test(forwardApplyReceipt.sourceTree??'')||resolve(git(['rev-parse','--show-toplevel']))!==resolve('.')||git(['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none'])||git(['rev-parse','--verify','HEAD'])!==forwardApplyReceipt.sourceCommit||git(['rev-parse','--verify','HEAD^{tree}'])!==forwardApplyReceipt.sourceTree)throw new Error();
  }catch{throw new Error('Forward apply requires matching clean committed source provenance');}
}
scopePreflight();
const baseDeployment=process.env.ACADEMY_BASE_DEPLOYMENT_NAME??'academy-core-base';
const outputs=az(['deployment','group','show','--subscription',policy.subscriptionId,'--resource-group',policy.resourceGroup,'--name',baseDeployment]).properties.outputs;
const {vault,storage}=migrationTargetChecks(outputs,{prepare:action==='--prepare'});
const postgresHost=outputs.postgresHost?.value;
if(!/^[a-z0-9][a-z0-9-]{0,62}\.postgres\.database\.azure\.com$/.test(postgresHost??''))throw new Error('Invalid approved PostgreSQL host output');
const receipt=forwardApplyReceipt??JSON.parse(readFileSync('build/azure-core/migration-package-receipt.json','utf8'));
if(Boolean(forward)!==(receipt.packageType==='forward'))throw new Error('Forward actions require an explicit forward package and action');
if(cutover&&receipt.packageType!=='cutover')throw new Error('Cutover action requires a cutover package');
if(!cutover&&receipt.packageType==='cutover')throw new Error('Cutover package requires an explicit cutover action');
if(!probe&&receipt.packageType==='probe')throw new Error('Diagnostic-only package cannot run schema/import/authenticator actions');
const encryptedPath=`build/azure-core/private/${receipt.blobName}`;
if(createHash('sha256').update(readFileSync(encryptedPath)).digest('hex')!==receipt.sha256)throw new Error('Encrypted package does not match receipt');
const keyName=`migration-key-${receipt.sha256.slice(0,16)}`;
const receiptName=action==='--prepare'?(forward?`${forward}-${receipt.sha256}-${Date.now()}-${randomUUID()}.json`:probe?`probe-${receipt.sha256.slice(0,16)}-${Date.now()}.json`:`${cutover??(configureAuthenticator?'authenticator':'reconciliation')}-${receipt.sha256}.json`):JSON.parse(readFileSync('build/azure-core/migration-job-parameters.json','utf8')).parameters.receiptBlobName.value;
const hostedReceiptPath=forward?`build/azure-core/hosted-${forward}.json`:cutover?`build/azure-core/hosted-${cutover}.json`:probe?'build/azure-core/hosted-target-probe.json':configureAuthenticator?'build/azure-core/hosted-authenticator-receipt.json':'build/azure-core/hosted-target-reconciliation.json';
if(forward&&!new RegExp(`^${forward}-${receipt.sha256}-[0-9]+-[a-f0-9-]{36}\\.json$`).test(receiptName))throw new Error('Prepared forward receipt does not match requested action/package');
const run=(args)=>{try{return execFileSync('az',[...args,'--only-show-errors','-o','none'],{stdio:['ignore','pipe','pipe']});}catch{throw new Error(`Azure migration ${args.slice(0,3).join(' ')} failed; inspect permissions/target privately. Raw provider errors suppressed to avoid secret output.`);}};
if(action==='--prepare') {
  // Operator requires Key Vault Secrets Officer and Blob Data Contributor on these Academy resources.
  run(['keyvault','secret','set','--vault-name',vault,'--name',keyName,'--file','build/azure-core/private/migration-package-key.txt','--subscription',policy.subscriptionId]);
  if(configureAuthenticator){
    authenticatorExpiry(process.env.AZURE_AUTHENTICATOR_EXPIRES_AT);
    const passwordPath='build/azure-core/private/authenticator-password.txt';
    if((statSync(passwordPath).mode&0o077)!==0||readFileSync(passwordPath,'utf8').length<32||readFileSync(passwordPath,'utf8').length>256)throw new Error('Authenticator password file must be mode0600 and32–256 characters');
    run(['keyvault','secret','set','--vault-name',vault,'--name','postgrest-authenticator-password','--file','build/azure-core/private/authenticator-password.txt','--subscription',policy.subscriptionId]);
  }
  const parameters={parameters:Object.fromEntries(Object.entries({vaultName:vault,postgresHost:postgresHost,storageAccountName:storage,packageBlobName:receipt.blobName,packageSha256:receipt.sha256,receiptBlobName:receiptName,packageKeySecretName:keyName,migrationAction:requestedAction,authenticatorPasswordSecretName:configureAuthenticator?'postgrest-authenticator-password':'',authenticatorExpiresAt:process.env.AZURE_AUTHENTICATOR_EXPIRES_AT??''}).map(([key,value])=>[key,{value}]))};
  writeFileSync('build/azure-core/migration-job-parameters.json',JSON.stringify(parameters,null,2)+'\n',{mode:0o600});
  run(['deployment','group','create','--subscription',policy.subscriptionId,'--resource-group',policy.resourceGroup,'--name','academy-core-migration','--template-file','infra/azure-core/migration-job.bicep','--parameters','@build/azure-core/migration-job-parameters.json','--mode','Incremental']);
  run(['storage','blob','upload','--subscription',policy.subscriptionId,'--account-name',storage,'--container-name','migration-packages','--name',receipt.blobName,'--file',encryptedPath,'--auth-mode','login','--overwrite',(configureAuthenticator||probe||cutover||forward)?'true':'false']);
  console.log('Manual private migration job and encrypted blob prepared. The job has not run. Review the initial rehearsal snapshot and start explicitly.');
}else if(action==='--start') {
  const job=az(['containerapp','job','show','--subscription',policy.subscriptionId,'--resource-group',policy.resourceGroup,'--name','vfa-core-migration']);
  const env=job.properties.template.containers[0].env;
  if(forward&&env.find(e=>e.name==='MIGRATION_RECEIPT_URL')?.value!==`https://${storage}.blob.core.windows.net/migration-receipts/${receiptName}`)throw new Error('Prepared forward receipt destination does not match requested start');
  if(env.find(e=>e.name==='AZURE_TARGET_HOST')?.value!==postgresHost||env.find(e=>e.name==='MIGRATION_VAULT_HOST')?.value!==`${vault}.vault.azure.net`||env.find(e=>e.name==='MIGRATION_ADMIN_SECRET_URL')?.value!==`https://${vault}.vault.azure.net/secrets/migration-admin-uri`||env.find(e=>e.name==='MIGRATION_PACKAGE_KEY_SECRET_URL')?.value!==`https://${vault}.vault.azure.net/secrets/${keyName}`||env.find(e=>e.name==='MIGRATION_ACTION')?.value!==requestedAction||env.find(e=>e.name==='MIGRATION_PACKAGE_SHA256')?.value!==receipt.sha256||env.find(e=>e.name==='MIGRATION_PACKAGE_URL')?.value!==`https://${storage}.blob.core.windows.net/migration-packages/${receipt.blobName}`)throw new Error('Prepared job action/package does not match requested start');
  const executions=az(['containerapp','job','execution','list','--subscription',policy.subscriptionId,'--resource-group',policy.resourceGroup,'--name','vfa-core-migration']);
  if(executions.some(item=>['Running','Processing','Pending'].includes(item.properties?.status)))throw new Error('A migration job is already active');
  run(['containerapp','job','start','--subscription',policy.subscriptionId,'--resource-group',policy.resourceGroup,'--name','vfa-core-migration']);
  console.log('Manual migration started. Query job execution status, then use --receipt. A start response is not a success receipt.');
}else{
  try {
    // Forward runs retain immutable remote names; this fixed local filename represents the selected run.
    run(['storage','blob','download','--subscription',policy.subscriptionId,'--account-name',storage,'--container-name','migration-receipts','--name',receiptName,'--file',hostedReceiptPath,'--auth-mode','login','--overwrite',forward?'true':'false']);
  }catch{
    run(['storage','blob','download','--subscription',policy.subscriptionId,'--account-name',storage,'--container-name','migration-receipts','--name',receiptName+'.failure.json','--file','build/azure-core/hosted-job-failure.json','--auth-mode','login','--overwrite','true']);
    const failure=JSON.parse(readFileSync('build/azure-core/hosted-job-failure.json','utf8'));
    const stages=['validate_config','validate_key_vault_urls','managed_identity','managed_identity_key_vault','fetch_package_key','fetch_admin_uri','validate_database_target','fetch_authenticator_password','download_package','verify_ciphertext','decrypt_package','stage_archive','validate_archive','extract_package','load_schema_step_names','probe_target','configure_authenticator','apply_schema','import_snapshot','read_reconciliation_receipt','upload_receipt','cutover_action','forward_action'];
    if(failure.status!=='failed'||!stages.includes(failure.stage)||failure.errorCode!=='MIGRATION_STAGE_FAILED')throw new Error('Invalid diagnostic failure receipt');
    const safe={status:'failed',stage:failure.stage,errorCode:failure.errorCode};
    if(failure.stage==='forward_action'&&failure.childErrorCode==='FORWARD_FAILED')safe.childErrorCode='FORWARD_FAILED';
    if(/^[0-9A-Z]{5}$/.test(failure.sqlState??''))safe.sqlState=failure.sqlState;
    if(Number.isInteger(failure.childExitCode))safe.childExitCode=failure.childExitCode;
    if(Number.isInteger(failure.httpStatus))safe.httpStatus=failure.httpStatus;
    if(Number.isInteger(failure.secretAttempts))safe.secretAttempts=failure.secretAttempts;
    if(failure.stage==='apply_schema'){
      const {azureSchemaStepNames}=await import('../../../scripts/azure-core/schema.mjs');
      if(new Set(azureSchemaStepNames()).has(failure.schemaStep))safe.schemaStep=failure.schemaStep;
      if(Number.isSafeInteger(failure.position)&&failure.position>0)safe.position=failure.position;
    }
    const codes=['ENOENT','EACCES','ENOSPC','ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ERR_MODULE_NOT_FOUND','ERR_OSSL_BAD_DECRYPT','ERR_CRYPTO_INVALID_AUTH_TAG','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN'];
    if(codes.includes(failure.runtimeCode))safe.runtimeCode=failure.runtimeCode;
    console.error(JSON.stringify(safe));
    console.error('Failed job diagnostic only. Target state is not established by this receipt; do not retry writes blindly.');
    process.exit(1);
  }
  const actual=JSON.parse(readFileSync(hostedReceiptPath,'utf8'));
  if(forward)validateForwardReceipt(actual,forward);
  else if(cutover){if(actual.action!==cutover||!actual.manifestSha256)throw new Error('Invalid cutover receipt');const manifest=readFileSync('build/azure-core/private/cutover-manifest.json');if(createHash('sha256').update(manifest).digest('hex')!==actual.manifestSha256)throw new Error('Mapping manifest differs from executed artifact');if(cutover==='final-sync'&&!actual.reconciliation)throw new Error('Missing final reconciliation');}
  else if(probe){if(actual.action!=='probe'||actual.readOnly!==true)throw new Error('Invalid read-only probe receipt');}
  else if(configureAuthenticator){if(actual.role!=='academy_authenticator')throw new Error('Invalid authenticator receipt');authenticatorExpiry(actual.expiresAt);}
  else {
    const snapshot=JSON.parse(readFileSync('build/azure-core/private/source-snapshot.json','utf8'));
    if(snapshot.schemaSha256!==receipt.schemaSha256)throw new Error('Local snapshot changed since packaging; restore the matching reviewed snapshot to verify receipt');
    const expected=snapshotReceipt(snapshot);
    const projection=Object.fromEntries(Object.keys(expected).map(key=>[key,actual[key]]));
    if(JSON.stringify(canonical(expected))!==JSON.stringify(canonical(projection)))throw new Error('Hosted receipt does not match every source table/user/storage/sequence hash');
  }
  console.log('Hosted receipt matches the local package/source contract. This is reconciliation evidence, not hosted functional/performance/cutover acceptance.');
}

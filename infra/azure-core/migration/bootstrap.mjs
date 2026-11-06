/* global validateArchiveListing, tarListingArguments, FORWARD_ACTIONS, validateForwardReceipt, ASSESSMENT_ACTIONS, validateAssessmentReceipt */
// Bicep prefixes archive-policy.mjs; executed inside a pinned Node container. No dependency download or public DB exception.
import { createHash, createDecipheriv } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, rmSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const work=`/tmp/academy-migration-${process.pid}`;
let stage='validate_config';
let failureReceiptContext=null;
let allowedSchemaSteps=new Set();
const mark=value=>{stage=value;console.log(JSON.stringify({status:'stage',stage}));};
function safeFailure(error) {
  const result={status:'failed',stage,errorCode:'MIGRATION_STAGE_FAILED'};
  if(Number.isInteger(error?.status))result.childExitCode=error.status;
  if(Number.isInteger(error?.httpStatus))result.httpStatus=error.httpStatus;
  if(Number.isInteger(error?.secretAttempts))result.secretAttempts=error.secretAttempts;
  const allowed=['ENOENT','EACCES','ENOSPC','ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ERR_MODULE_NOT_FOUND','ERR_OSSL_BAD_DECRYPT','ERR_CRYPTO_INVALID_AUTH_TAG','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN'];
  const code=error?.code??error?.cause?.code;
  if(allowed.includes(code))result.runtimeCode=code;
  for(const line of String(error?.stderr??'').split('\n')) {
    try {const parsed=JSON.parse(line);if(/^[0-9A-Z]{5}$/.test(parsed.sqlState??''))result.sqlState=parsed.sqlState;if(allowed.includes(parsed.runtimeCode))result.runtimeCode=parsed.runtimeCode;if(['MIGRATION_FAILED','PROBE_FAILED','AUTHENTICATOR_FAILED','CUTOVER_FAILED','FORWARD_FAILED','FORWARD_53_FAILED','FORWARD_54_FAILED'].includes(parsed.errorCode))result.childErrorCode=parsed.errorCode;if(parsed.errorCode==='MIGRATION_FAILED'&&stage==='apply_schema'){if(allowedSchemaSteps.has(parsed.schemaStep))result.schemaStep=parsed.schemaStep;if(Number.isSafeInteger(parsed.position)&&parsed.position>0)result.position=parsed.position;}}catch{/* Raw stderr and SQL values are never forwarded. */}
    for(const known of allowed)if(line.includes(`code: '${known}'`))result.runtimeCode=known;
  }
  return result;
}
const httpError=(code,status)=>Object.assign(new Error(code),{httpStatus:status});
function approvedSecretUrl(value,vaultHost,name){
  const expected=`https://${vaultHost}/secrets/${name}`;
  if(!/^vfakv[a-z0-9]{13}\.vault\.azure\.net$/.test(vaultHost)||value!==expected)throw new Error('invalid_secret_url');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!==vaultHost||url.port||url.username||url.password||url.search||url.hash)throw new Error('invalid_secret_url');
  return url;
}
function validateDatabaseTarget(value,expectedHost){
  const url=new URL(value);
  if(!/^[a-z0-9][a-z0-9-]{0,62}\.postgres\.database\.azure\.com$/.test(expectedHost??'')||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==expectedHost||url.pathname!=='/academy'||(url.port&&url.port!=='5432')||decodeURIComponent(url.username)!=='academy_admin'||!url.password||value.includes('#')||[...url.searchParams.keys()].some(name=>name!=='sslmode')||url.searchParams.getAll('sslmode').length>1||(url.searchParams.has('sslmode')&&url.searchParams.get('sslmode')!=='verify-full'))throw new Error('invalid_database_target');
  return value;
}
async function identityToken(env,resource){
  const identity=new URL(env.IDENTITY_ENDPOINT);
  identity.searchParams.set('api-version','2019-08-01');identity.searchParams.set('resource',resource);identity.searchParams.set('client_id',env.AZURE_CLIENT_ID);
  const response=await fetch(identity,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw httpError('identity_unavailable',response.status);
  const result=await response.json();if(typeof result.access_token!=='string'||!result.access_token)throw new Error('invalid_identity_token');
  return result.access_token;
}
async function readSecret(url,token){
  const endpoint=new URL(url);endpoint.searchParams.set('api-version','2025-07-01');
  for(let attempt=1;attempt<=5;attempt++){
    const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(response.status===200){const result=await response.json();if(typeof result.value!=='string'||!result.value||result.value.length>16384)throw new Error('invalid_secret_value');return result.value;}
    if(![403,429,502,503,504].includes(response.status)||attempt===5)throw Object.assign(httpError('key_vault_secret_unavailable',response.status),{secretAttempts:attempt});
    await new Promise(resolve=>setTimeout(resolve,250*2**(attempt-1)));
  }
  throw new Error('key_vault_secret_unavailable');
}

(async () => {
  const env=process.env;
  const lane=env.MIGRATION_ACTION?.startsWith('forward-54-')?'54':'53';
  mark('validate_config');
  if(!['probe','configure-authenticator','map-identities','final-sync','schema-import',...Object.keys(FORWARD_ACTIONS),...Object.keys(ASSESSMENT_ACTIONS)].includes(env.MIGRATION_ACTION))throw new Error('invalid_migration_action');
  const endpoint=new URL(env.MIGRATION_PACKAGE_URL);
  if(endpoint.protocol!=='https:' || !endpoint.hostname.endsWith('.blob.core.windows.net') || endpoint.search || endpoint.hash) throw new Error('invalid_blob_endpoint');
  const receiptUrl=new URL(env.MIGRATION_RECEIPT_URL);
  if(receiptUrl.origin!==endpoint.origin || !receiptUrl.pathname.startsWith('/migration-receipts/') || receiptUrl.search || receiptUrl.hash)throw new Error('invalid_receipt_destination');
  mark('managed_identity');
  const access_token=await identityToken(env,'https://storage.azure.com/');
  failureReceiptContext={url:new URL(receiptUrl.toString()+'.failure.json'),token:access_token};
  mark('download_package');
  const result=await fetch(endpoint,{headers:{Authorization:`Bearer ${access_token}`,'x-ms-version':'2023-11-03'},redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!result.ok)throw httpError('package_unavailable',result.status);
  mark('verify_ciphertext');
  const encrypted=Buffer.from(await result.arrayBuffer());
  if(createHash('sha256').update(encrypted).digest('hex')!==env.MIGRATION_PACKAGE_SHA256)throw new Error('package_digest_mismatch');
  mark('validate_key_vault_urls');
  const vaultHost=env.MIGRATION_VAULT_HOST;
  const keyUrl=approvedSecretUrl(env.MIGRATION_PACKAGE_KEY_SECRET_URL,vaultHost,`migration-key-${env.MIGRATION_PACKAGE_SHA256.slice(0,16)}`);
  const adminUrl=approvedSecretUrl(env.MIGRATION_ADMIN_SECRET_URL,vaultHost,'migration-admin-uri');
  const authenticatorUrl=env.MIGRATION_ACTION==='configure-authenticator'?approvedSecretUrl(env.MIGRATION_AUTHENTICATOR_SECRET_URL,vaultHost,'postgrest-authenticator-password'):null;
  mark('managed_identity_key_vault');
  const vaultToken=await identityToken(env,'https://vault.azure.net');
  mark('fetch_package_key');
  let encodedKey=await readSecret(keyUrl,vaultToken);
  const key=Buffer.from(encodedKey,'base64');
  if(key.length!==32||key.toString('base64')!==encodedKey)throw new Error('invalid_key');
  encodedKey=undefined;
  mark('decrypt_package');
  const decrypt=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));decrypt.setAuthTag(encrypted.subarray(12,28));
  const plain=Buffer.concat([decrypt.update(encrypted.subarray(28)),decrypt.final()]);
  mark('stage_archive');
  mkdirSync(work,{recursive:true,mode:0o700});
  const archive=work+'/package.tar.gz';writeFileSync(archive,plain,{mode:0o600});
  mark('validate_archive');
  const archiveEnv={...env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
  validateArchiveListing(execFileSync('tar',tarListingArguments(archive,execFileSync('tar',['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv})),{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv}));
  mark('extract_package');
  execFileSync('tar',['-xzf',archive,'-C',work],{stdio:'pipe',env:archiveEnv});rmSync(archive);plain.fill(0);key.fill(0);
  if(Object.hasOwn(ASSESSMENT_ACTIONS,env.MIGRATION_ACTION)){
    mark('verify_assessment_artifact');
    const bytes=readFileSync(work+`/build/azure-core/private/forward-${lane}-source-manifest.json`);
    if(bytes.length>4*1024*1024||!/^[a-f0-9]{64}$/.test(env.MIGRATION_SOURCE_MANIFEST_SHA256??'')||createHash('sha256').update(bytes).digest('hex')!==env.MIGRATION_SOURCE_MANIFEST_SHA256)throw new Error('assessment_manifest_mismatch');
    const manifest=JSON.parse(bytes);
    if(env.MIGRATION_ACTION===`forward-${lane}-apply`&&!/^[a-f0-9]{64}$/.test(manifest.reviewedPlanSha256??''))throw new Error('assessment_reviewed_plan_missing');
    if(manifest.source?.sourceClean!==true||manifest.source.sourceCommit!==env.MIGRATION_SOURCE_COMMIT||manifest.source.sourceTree!==env.MIGRATION_SOURCE_TREE||!/^[a-f0-9]{40}$/.test(manifest.source.sourceCommit??'')||!/^[a-f0-9]{40}$/.test(manifest.source.sourceTree??'')||manifest.contentSha256!==env.MIGRATION_PACKAGE_CONTENT_SHA256||!/^[a-f0-9]{64}$/.test(manifest.contentSha256??'')||!Array.isArray(manifest.files)||manifest.files.length>5000)throw new Error('assessment_source_mismatch');
    // Verify every executable/dependency byte with the trusted inline bootstrap,
    // before importing even the packaged verifier and before fetching DB credentials.
    for(const file of manifest.files){
      if(typeof file.path!=='string'||file.path.startsWith('/')||/[\\\x00-\x1f\x7f]/.test(file.path)||file.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(file.sha256??''))throw new Error('assessment_file_invalid');
      const path=work+'/'+file.path;if(!lstatSync(path).isFile()||lstatSync(path).size>16*1024*1024||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw new Error('assessment_file_mismatch');
    }
    execFileSync(process.execPath,[`scripts/azure-core/forward-${lane}-job.mjs`,'verify'],{cwd:work,env:{PATH:env.PATH,LC_ALL:'C'},stdio:['ignore','pipe','pipe'],timeout:120000});
  }
  if(env.MIGRATION_ACTION==='schema-import'){
    mark('load_schema_step_names');
    const {azureSchemaStepNames}=await import(pathToFileURL(work+'/scripts/azure-core/schema.mjs').href);
    allowedSchemaSteps=new Set(azureSchemaStepNames());
  }
  mark('fetch_admin_uri');
  const adminUri=await readSecret(adminUrl,vaultToken);
  mark('validate_database_target');
  validateDatabaseTarget(adminUri,env.AZURE_TARGET_HOST);
  const runtimeEnv={...env,NODE_EXTRA_CA_CERTS:work+'/infra/azure-core/postgres-roots.crt',AZURE_DATABASE_URL:adminUri};
  delete runtimeEnv.MIGRATION_PACKAGE_KEY;delete runtimeEnv.IDENTITY_HEADER;
  delete runtimeEnv.AZURE_AUTHENTICATOR_PASSWORD;
  if(authenticatorUrl){mark('fetch_authenticator_password');runtimeEnv.AZURE_AUTHENTICATOR_PASSWORD=await readSecret(authenticatorUrl,vaultToken);}

  let receipt;
  if (env.MIGRATION_ACTION === 'probe') {
    mark('probe_target');
    const output=execFileSync(process.execPath,['infra/azure-core/migration/probe.mjs'],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:120000});
    const observed=JSON.parse(output.toString('utf8'));
    if(observed.action!=='probe'||observed.readOnly!==true)throw new Error('invalid_probe_receipt');
    receipt=Buffer.from(JSON.stringify(observed));
  } else if (env.MIGRATION_ACTION === 'configure-authenticator') {
    mark('configure_authenticator');
    const output=execFileSync(process.execPath,['scripts/azure-core/configure-authenticator.mjs'],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:120000});
    const configured=JSON.parse(output.toString('utf8'));
    if(configured.role!=='academy_authenticator'||!configured.expiresAt)throw new Error('invalid_authenticator_receipt');
    receipt=Buffer.from(JSON.stringify({role:configured.role,expiresAt:configured.expiresAt,configuredAt:new Date().toISOString()}));
  } else if (['map-identities','final-sync'].includes(env.MIGRATION_ACTION)) {
    mark('cutover_action');
    const output=execFileSync(process.execPath,['scripts/azure-core/cutover.mjs',env.MIGRATION_ACTION],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:300000});
    const result=JSON.parse(output.toString('utf8'));
    if(result.action!==env.MIGRATION_ACTION||!Number.isInteger(result.mappings)||!result.manifestSha256)throw new Error('invalid_cutover_receipt');
    receipt=Buffer.from(JSON.stringify(result));
  } else if (Object.hasOwn(FORWARD_ACTIONS,env.MIGRATION_ACTION)) {
    mark('forward_action');
    const forwardEntrypoint=[work,'scripts','azure-core','forward-cli.mjs'].join('/');
    const output=execFileSync(process.execPath,[forwardEntrypoint,FORWARD_ACTIONS[env.MIGRATION_ACTION].mode],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:300000});
    const observed=validateForwardReceipt(JSON.parse(output.toString('utf8')),env.MIGRATION_ACTION);
    receipt=Buffer.from(JSON.stringify(observed));
  } else if (Object.hasOwn(ASSESSMENT_ACTIONS,env.MIGRATION_ACTION)) {
    mark('assessment_action');
    const output=execFileSync(process.execPath,[`scripts/azure-core/forward-${lane}-job.mjs`,ASSESSMENT_ACTIONS[env.MIGRATION_ACTION].mode],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:300000});
    const observed=validateAssessmentReceipt(JSON.parse(output.toString('utf8')),env.MIGRATION_ACTION);
    if(observed.packageContentSha256!==env.MIGRATION_PACKAGE_CONTENT_SHA256||observed.source.sourceCommit!==env.MIGRATION_SOURCE_COMMIT||observed.source.sourceTree!==env.MIGRATION_SOURCE_TREE)throw new Error('assessment_receipt_package_mismatch');
    receipt=Buffer.from(JSON.stringify(validateAssessmentReceipt({...observed,encryptedPackageSha256:env.MIGRATION_PACKAGE_SHA256,sourceManifestSha256:env.MIGRATION_SOURCE_MANIFEST_SHA256},env.MIGRATION_ACTION,{transport:true})));
  } else if (env.MIGRATION_ACTION === 'schema-import') {
    for(const action of ['schema','import']) { mark(action==='schema'?'apply_schema':'import_snapshot'); execFileSync(process.execPath,['scripts/azure-core/migrate.mjs',action,'--apply'],{cwd:work,env:runtimeEnv,stdio:['ignore','pipe','pipe'],timeout:900000}); }
    mark('read_reconciliation_receipt');
    // The receipt contains counts/hashes/sequence states only; never row values or credentials.
    receipt=readFileSync(work+'/build/azure-core/target-reconciliation.json');
  } else throw new Error('invalid_migration_action');
  mark('upload_receipt');
  const upload=await fetch(receiptUrl,{method:'PUT',headers:{Authorization:`Bearer ${access_token}`,'x-ms-version':'2023-11-03','x-ms-blob-type':'BlockBlob','If-None-Match':'*','Content-Type':'application/json'},body:receipt,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!upload.ok)throw httpError('receipt_upload_failed',upload.status);
  console.log(JSON.stringify({status:Object.hasOwn(ASSESSMENT_ACTIONS,env.MIGRATION_ACTION)?'assessment_action_completed':Object.hasOwn(FORWARD_ACTIONS,env.MIGRATION_ACTION)?'forward_action_completed':env.MIGRATION_ACTION==='probe'?'target_probed':env.MIGRATION_ACTION==='schema-import'?'schema_and_import_reconciled':env.MIGRATION_ACTION==='configure-authenticator'?'authenticator_configured':'cutover_action_completed',packageSha256:env.MIGRATION_PACKAGE_SHA256,receiptSha256:createHash('sha256').update(receipt).digest('hex')}));
  rmSync(work,{recursive:true,force:true});
})().catch(async error=>{
  rmSync(work,{recursive:true,force:true});
  const failure=safeFailure(error);
  let failureReceiptPersisted=false;
  if(failureReceiptContext){
    try {
      const persisted=await fetch(failureReceiptContext.url,{method:'PUT',headers:{Authorization:`Bearer ${failureReceiptContext.token}`,'x-ms-version':'2023-11-03','x-ms-blob-type':'BlockBlob','If-None-Match':'*','Content-Type':'application/json'},body:JSON.stringify(failure),redirect:'error',signal:AbortSignal.timeout(15000)});
      failureReceiptPersisted=persisted.ok;
    }catch{/* If managed identity or Storage is unavailable, live console is the only evidence. */}
  }
  console.error(JSON.stringify({...failure,failureReceiptPersisted}));
  process.exitCode=1;
});

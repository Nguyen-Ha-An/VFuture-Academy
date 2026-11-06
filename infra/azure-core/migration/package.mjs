import { cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes,createCipheriv,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isArchiveMetadataPath,validateArchiveListing,tarListingArguments } from '../archive-policy.mjs';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';
import { forward53SourceFiles,forward53Evidence,createForward53ArtifactManifest,FORWARD53_MANIFEST,FORWARD53_EVIDENCE,FORWARD53_PLAN } from '../../../scripts/azure-core/forward-53-artifact.mjs';
import { createForward53PackageManifest } from '../../../scripts/azure-core/forward-53-package.mjs';
function sourceProvenance(){
  const unavailable={sourceClean:false,sourceCommit:null,sourceTree:null};
  try{
    const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(resolve(git(['rev-parse','--show-toplevel']))!==resolve('.')||git(['status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none']))return unavailable;
    const sourceCommit=git(['rev-parse','--verify','HEAD']),sourceTree=git(['rev-parse','--verify','HEAD^{tree}']);
    if(!/^[a-f0-9]{40}$/.test(sourceCommit)||!/^[a-f0-9]{40}$/.test(sourceTree))return unavailable;
    return {sourceClean:true,sourceCommit,sourceTree};
  }catch{return unavailable;}
}
const privateDir=resolve('build/azure-core/private');mkdirSync(privateDir,{recursive:true,mode:0o700});
const probe=process.argv.includes('--probe');
const cutover=process.argv.includes('--cutover');
const forward=process.argv.includes('--forward');
const selectedLanes=['53','54','55'].filter(value=>process.argv.includes(`--forward-${value}`));
if(selectedLanes.length>1)throw new Error('Choose one fixed forward package');
const assessment=selectedLanes.length===1;
const lane=selectedLanes[0]??'53';
const bounded=lane!=='53'?await import(`../../../scripts/azure-core/forward-${lane}-artifact.mjs`):null;
const boundedFiles=bounded?.[`forward${lane}SourceFiles`]??forward53SourceFiles;
const boundedEvidence=bounded?.[`forward${lane}Evidence`]??forward53Evidence;
const boundedManifest=bounded?.[`createForward${lane}ArtifactManifest`]??createForward53ArtifactManifest;
const boundedReview=bounded?(await import(`../../../scripts/azure-core/forward-${lane}-package.mjs`))[`createForward${lane}PackageManifest`]:createForward53PackageManifest;
const manifestPath=bounded?.[`FORWARD${lane}_MANIFEST`]??FORWARD53_MANIFEST;
const evidencePath=bounded?.[`FORWARD${lane}_EVIDENCE`]??FORWARD53_EVIDENCE;
const planPath=bounded?.[`FORWARD${lane}_PLAN`]??FORWARD53_PLAN;
if([probe,cutover,forward,assessment].filter(Boolean).length>1)throw new Error('Choose one package action');
const snapshot=probe||forward||assessment?null:JSON.parse(readFileSync(join(privateDir,'source-snapshot.json'),'utf8'));
// The released V1 forward job is fixed at52. New migrations use their separately
// reviewed executor/package, never an implicit expansion of this archive.
const currentSchema=probe?null:buildAzureSchema(forward?{through:'20261105020000_teaching_permissions_activation.sql'}:assessment?{through:lane==='55'?'20261106040000_management_teaching_scope.sql':lane==='54'?'20261106000000_managed_profile_handles.sql':'20261105030000_exam_attachment_bindings.sql'}:{});
if(forward&&currentSchema.receipt.migrations.length!==52)throw new Error('Forward package requires the fixed reviewed 52 migrations');
if(snapshot&&snapshot.schemaSha256!==currentSchema.receipt.schemaSha256)throw new Error('Snapshot schema digest differs from current reviewed code; rebuild/rehearse before upload.');
const originalProvenance=forward||assessment?sourceProvenance():null;
let assessmentEvidence,assessmentPlan,assessmentManifest;
if(assessment){
  if(!originalProvenance.sourceClean)throw new Error('Fixed forward packaging requires clean committed source');
  const evidence=readFileSync(evidencePath);if(evidence.length>65536)throw new Error('Invalid fixed forward evidence');
  assessmentEvidence=boundedEvidence(JSON.parse(evidence));
  if(existsSync(planPath)){const plan=readFileSync(planPath);if(plan.length>65536)throw new Error('Invalid reviewed fixed forward plan');assessmentPlan=JSON.parse(plan);boundedReview(assessmentPlan,{v1Evidence:assessmentEvidence});}
}
const staging=mkdtempSync(join(privateDir,'migration-stage-'));
try {
  const files=probe?['infra/azure-core/migration/probe.mjs','scripts/azure-core/target.mjs','infra/azure-core/postgres-roots.crt']:['infra/azure-core/migration/probe.mjs','scripts/azure-core/migrate.mjs','scripts/azure-core/target.mjs','scripts/azure-core/diagnostics.mjs','scripts/azure-core/configure-authenticator.mjs','scripts/azure-core/restore.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/baselines/identity-pre-handles.sql','scripts/azure-core/snapshot.mjs','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','supabase/migrations','infra/azure-core/postgres-roots.crt','build/azure-core/private/source-snapshot.json'];
  if(forward){
    files.splice(0,files.length,'scripts/azure-core/forward.mjs','scripts/azure-core/forward-cli.mjs','scripts/azure-core/target.mjs','scripts/azure-core/diagnostics.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/baselines/identity-pre-handles.sql','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','infra/azure-core/postgres-roots.crt',...currentSchema.receipt.migrations.map(row=>`supabase/migrations/${row.file}`));
    for(const optional of ['build/azure-core/private/forward-plan.json','build/azure-core/private/forward-deployment-evidence.json'])if(existsSync(optional))files.push(optional);
  }
  if(assessment)files.splice(0,files.length,...boundedFiles(),evidencePath,...(assessmentPlan?[planPath]:[]));
  if(cutover)files.push('scripts/azure-core/cutover.mjs','build/azure-core/private/cutover-manifest.json');
  for(const path of files){const target=join(staging,path);mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(path,target,{recursive:true,filter:source=>!isArchiveMetadataPath(source)});}
  if(!assessment)writeFileSync(join(staging,'package.json'),'{"type":"module","private":true}\n',{mode:0o600});
  const locked=assessment?JSON.parse(readFileSync('package-lock.json','utf8')):null;
  const copied=new Map();
  function copyDependency(name,from) {
    const require=createRequire(join(from,'package.json'));
    let manifest;
    try { manifest=require.resolve(`${name}/package.json`); } catch {
      let directory=dirname(require.resolve(name));
      while(directory!==dirname(directory)){const candidate=join(directory,'package.json');if(existsSync(candidate)&&JSON.parse(readFileSync(candidate,'utf8')).name===name){manifest=candidate;break;}directory=dirname(directory);}
      if(!manifest)throw new Error(`Missing locked runtime dependency ${name}`);
    }
    const pkg=JSON.parse(readFileSync(manifest,'utf8'));
    if(assessment&&locked.packages?.[`node_modules/${name}`]?.version!==pkg.version)throw new Error('Fixed forward requires locked pg dependency versions');
    if(copied.has(name)){if(copied.get(name)!==pkg.version)throw new Error('Dependency version conflict requires package review');return;}
    copied.set(name,pkg.version);
    cpSync(dirname(manifest),join(staging,'node_modules',name),{recursive:true,filter:source=>!isArchiveMetadataPath(source)});
    for(const dependency of Object.keys(pkg.dependencies??{}))copyDependency(dependency,dirname(manifest));
    for(const dependency of Object.keys(pkg.optionalDependencies??{})){
      if(assessment){
        try{createRequire(join(dirname(manifest),'package.json')).resolve(dependency);}catch(error){if(error.code==='MODULE_NOT_FOUND')continue;throw error;}
        copyDependency(dependency,dirname(manifest));
      }else try{copyDependency(dependency,dirname(manifest));}catch{ /* Optional native/platform package is not used by pg's JS path. */ }
    }
  }
  copyDependency('pg',resolve('.'));
  if(assessment){
    assessmentManifest=boundedManifest({root:staging,source:originalProvenance,evidence:assessmentEvidence,reviewedPlan:assessmentPlan});
    writeFileSync(join(staging,manifestPath),JSON.stringify(assessmentManifest,null,2)+'\n',{mode:0o600});
    execFileSync(process.execPath,[`scripts/azure-core/forward-${lane}-job.mjs`,'verify'],{cwd:staging,env:{PATH:process.env.PATH,LC_ALL:'C'},stdio:'pipe'});
  }
  const archive=join(privateDir,'migration-package.tar.gz');
  const archiveEnv={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
  execFileSync('tar',['-czf',archive,'-C',staging,'.'],{stdio:'pipe',env:archiveEnv});
  // Inspect real members before any Mac extraction can absorb AppleDouble sidecars.
  validateArchiveListing(execFileSync('tar',tarListingArguments(archive,execFileSync('tar',['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv})),{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv}));
  const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  const encryptedBody=Buffer.concat([cipher.update(readFileSync(archive)),cipher.final()]);
  const encrypted=Buffer.concat([nonce,cipher.getAuthTag(),encryptedBody]);
  const sha256=createHash('sha256').update(encrypted).digest('hex');
  const name=`migration-${sha256}.enc`;
  const finalProvenance=forward||assessment?sourceProvenance():null;
  const provenance=(forward||assessment)&&originalProvenance.sourceClean&&finalProvenance.sourceClean&&originalProvenance.sourceCommit===finalProvenance.sourceCommit&&originalProvenance.sourceTree===finalProvenance.sourceTree?finalProvenance:{sourceClean:false,sourceCommit:null,sourceTree:null};
  if(assessment&&!provenance.sourceClean)throw new Error('Fixed forward source changed during packaging');
  writeFileSync(join(privateDir,name),encrypted,{mode:0o600});
  writeFileSync(join(privateDir,'migration-package-key.txt'),key.toString('base64'),{mode:0o600});key.fill(0);
  if(assessment)writeFileSync(manifestPath,JSON.stringify(assessmentManifest,null,2)+'\n',{mode:0o600});
  writeFileSync('build/azure-core/migration-package-receipt.json',JSON.stringify({blobName:name,sha256,packageType:assessment?`forward-${lane}`:forward?'forward':probe?'probe':cutover?'cutover':'schema-import',schemaSha256:forward||assessment?currentSchema.receipt.schemaSha256:snapshot?.schemaSha256??null,...(forward||assessment?provenance:{}),...(assessment?{packageContentSha256:assessmentManifest.contentSha256,sourceManifestSha256:createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),reviewedPlanSha256:assessmentManifest.reviewedPlanSha256??null}:{}),dependencies:Object.fromEntries(copied),createdAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  rmSync(archive);
  console.log('Encrypted migration package and key prepared in ignored private directory; no cloud calls performed.');
}finally{if(existsSync(staging))rmSync(staging,{recursive:true,force:true});}

import { cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes,createCipheriv,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isArchiveMetadataPath,validateArchiveListing,tarListingArguments } from '../archive-policy.mjs';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';
const privateDir=resolve('build/azure-core/private');mkdirSync(privateDir,{recursive:true,mode:0o700});
const probe=process.argv.includes('--probe');
const snapshot=probe?null:JSON.parse(readFileSync(join(privateDir,'source-snapshot.json'),'utf8'));
if(!probe&&snapshot.schemaSha256!==buildAzureSchema().receipt.schemaSha256)throw new Error('Snapshot schema digest differs from current reviewed code; rebuild/rehearse before upload.');
const staging=mkdtempSync(join(privateDir,'migration-stage-'));
try {
  const files=probe?['infra/azure-core/migration/probe.mjs','scripts/azure-core/target.mjs','infra/azure-core/postgres-roots.crt']:['infra/azure-core/migration/probe.mjs','scripts/azure-core/migrate.mjs','scripts/azure-core/target.mjs','scripts/azure-core/diagnostics.mjs','scripts/azure-core/configure-authenticator.mjs','scripts/azure-core/restore.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/snapshot.mjs','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','supabase/migrations','infra/azure-core/postgres-roots.crt','build/azure-core/private/source-snapshot.json'];
  for(const path of files){const target=join(staging,path);mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(path,target,{recursive:true,filter:source=>!isArchiveMetadataPath(source)});}
  writeFileSync(join(staging,'package.json'),'{"type":"module","private":true}\n',{mode:0o600});
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
    if(copied.has(name)){if(copied.get(name)!==pkg.version)throw new Error('Dependency version conflict requires package review');return;}
    copied.set(name,pkg.version);
    cpSync(dirname(manifest),join(staging,'node_modules',name),{recursive:true,filter:source=>!isArchiveMetadataPath(source)});
    for(const dependency of Object.keys(pkg.dependencies??{}))copyDependency(dependency,dirname(manifest));
    for(const dependency of Object.keys(pkg.optionalDependencies??{})){try{copyDependency(dependency,dirname(manifest));}catch{ /* Optional native/platform package is not used by pg's JS path. */ }}
  }
  copyDependency('pg',resolve('.'));
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
  writeFileSync(join(privateDir,name),encrypted,{mode:0o600});
  writeFileSync(join(privateDir,'migration-package-key.txt'),key.toString('base64'),{mode:0o600});key.fill(0);
  writeFileSync('build/azure-core/migration-package-receipt.json',JSON.stringify({blobName:name,sha256,packageType:probe?'probe':'schema-import',schemaSha256:snapshot?.schemaSha256??null,dependencies:Object.fromEntries(copied),createdAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  rmSync(archive);
  console.log('Encrypted migration package and key prepared in ignored private directory; no cloud calls performed.');
}finally{if(existsSync(staging))rmSync(staging,{recursive:true,force:true});}

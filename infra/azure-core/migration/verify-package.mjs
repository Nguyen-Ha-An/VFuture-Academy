// Offline relocation check of the exact encrypted artifact. Never opens a DB connection.
import { validateArchiveListing,tarListingArguments } from '../archive-policy.mjs';
import { createHash,createDecipheriv } from 'node:crypto';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const receipt=JSON.parse(readFileSync('build/azure-core/migration-package-receipt.json','utf8'));
const encrypted=readFileSync(`build/azure-core/private/${receipt.blobName}`);
if(createHash('sha256').update(encrypted).digest('hex')!==receipt.sha256)throw new Error('Package digest mismatch');
const key=Buffer.from(readFileSync('build/azure-core/private/migration-package-key.txt','utf8'),'base64');
const decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));decipher.setAuthTag(encrypted.subarray(12,28));
const plaintext=Buffer.concat([decipher.update(encrypted.subarray(28)),decipher.final()]);
const folder=mkdtempSync(join(tmpdir(),'academy-private-package-'));
try{
  const archive=join(folder,'package.tar.gz');writeFileSync(archive,plaintext,{mode:0o600});plaintext.fill(0);key.fill(0);
  const archiveEnv={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
  validateArchiveListing(execFileSync('tar',tarListingArguments(archive,execFileSync('tar',['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv})),{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv}));
  execFileSync('tar',['-xzf',archive,'-C',folder],{stdio:'pipe',env:archiveEnv});rmSync(archive);
  if(receipt.packageType==='probe'){
    // Resolve from the relocated package, not from this verifier's module directory.
    execFileSync(process.execPath,['--input-type=module','-e','await import(process.argv[1]);',pathToFileURL(join(folder,'infra','azure-core','migration','probe.mjs')).href],{cwd:folder,env:{PATH:process.env.PATH,LC_ALL:'C'},stdio:'pipe'});
  }else if(['forward-53','forward-54'].includes(receipt.packageType)){
    const output=execFileSync(process.execPath,[`scripts/azure-core/${receipt.packageType}-job.mjs`,'verify'],{cwd:folder,env:{PATH:process.env.PATH,LC_ALL:'C'},stdio:['ignore','pipe','pipe'],encoding:'utf8'});
    const actual=JSON.parse(output);
    const manifest=readFileSync(join(folder,`build/azure-core/private/${receipt.packageType}-source-manifest.json`));
    if(actual.action!==`${receipt.packageType}-package`||actual.packageContentSha256!==receipt.packageContentSha256||actual.source.sourceCommit!==receipt.sourceCommit||actual.source.sourceTree!==receipt.sourceTree||createHash('sha256').update(manifest).digest('hex')!==receipt.sourceManifestSha256)throw new Error('Relocated53 package mismatch');
  }else if(receipt.packageType==='forward'){
    const cliUrl=pathToFileURL(join(folder,'scripts','azure-core','forward-cli.mjs')).href;
    const schemaUrl=pathToFileURL(join(folder,'scripts','azure-core','schema.mjs')).href;
    const actual=execFileSync(process.execPath,['--input-type=module','-e',`await import(process.argv[1]);const{buildAzureSchema}=await import(process.argv[2]);process.stdout.write(buildAzureSchema({through:'20261105020000_teaching_permissions_activation.sql'}).receipt.schemaSha256);`,cliUrl,schemaUrl],{cwd:folder,env:{PATH:process.env.PATH,LC_ALL:'C'},stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim();
    if(actual!==receipt.schemaSha256)throw new Error('Relocated package schema mismatch');
  }else{
  execFileSync(process.execPath,['scripts/azure-core/migrate.mjs','schema'],{cwd:folder,env:{PATH:process.env.PATH,LC_ALL:'C'},stdio:'pipe'});
  const actual=JSON.parse(readFileSync(join(folder,'build/azure-core/schema-receipt.json'),'utf8'));
  if(actual.schemaSha256!==receipt.schemaSha256)throw new Error('Relocated package schema mismatch');
  }
  console.log('Exact encrypted package decrypted and validated in isolation; pg runtime dependencies resolved (schema digest for migration packages; module loading only for snapshot-free probes). No cloud/database connection opened.');
}finally{rmSync(folder,{recursive:true,force:true});}

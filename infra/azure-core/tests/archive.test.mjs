import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isArchiveMetadataPath,validateArchiveListing,tarListingArguments} from '../archive-policy.mjs';
const archiveEnv={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
const version=execFileSync('tar',['--version'],{encoding:'utf8',env:archiveEnv});
const listing=archive=>execFileSync('tar',tarListingArguments(archive,version),{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:archiveEnv});
test('archive name policy rejects Mac metadata at any depth and unsafe/unexpected paths',()=>{
  const valid='./\n./supabase/\n./supabase/migrations/\n./supabase/migrations/0001_identity.sql\n./node_modules/pg/package.json\n';
  assert.equal(validateArchiveListing(valid).files,2);
  for(const path of ['./supabase/migrations/._0001_identity.sql','node_modules/pg/__MACOSX/file','src/.DS_Store','._root/child','/etc/passwd','../outside','node_modules/x/../../outside','credentials.json'])assert.throws(()=>validateArchiveListing(valid+path+'\n'));
  assert.throws(()=>validateArchiveListing('src/._index.mjs\n',{kind:'functions'}));
  assert.equal(validateArchiveListing('host.json\nsrc/index.mjs\nnode_modules/jose/package.json\n',{kind:'functions'}).files,3);
});
test('tar listing detects real AppleDouble members before any local extraction can absorb them',()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-archive-meta-'));
  try{
    const source=join(root,'source'),stage=join(root,'stage');mkdirSync(join(source,'supabase/migrations'),{recursive:true});
    writeFileSync(join(source,'supabase/migrations/0001_identity.sql'),'select 1;\n');
    writeFileSync(join(source,'supabase/migrations/._0001_identity.sql'),Buffer.from([0,5,22,7,0,2,0,0]));
    writeFileSync(join(source,'.DS_Store'),'metadata');mkdirSync(join(source,'__MACOSX'));writeFileSync(join(source,'__MACOSX/fixture'),'metadata');
    const bad=join(root,'bad.tar.gz');execFileSync('tar',['-czf',bad,'-C',source,'.'],{env:archiveEnv,stdio:'pipe'});
    assert.ok(listing(bad).includes('._0001_identity.sql'));assert.throws(()=>validateArchiveListing(listing(bad)));
    cpSync(source,stage,{recursive:true,filter:path=>!isArchiveMetadataPath(path)});
    assert.equal(existsSync(join(stage,'supabase/migrations/._0001_identity.sql')),false);
    const good=join(root,'good.tar.gz');execFileSync('tar',['-czf',good,'-C',stage,'.'],{env:archiveEnv,stdio:'pipe'});
    assert.equal(validateArchiveListing(listing(good)).files,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('macOS xattrs emit AppleDouble without COPYFILE_DISABLE and remain portable with it',{skip:process.platform!=='darwin'},()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-archive-xattr-'));
  try{
    const source=join(root,'source');mkdirSync(join(source,'supabase/migrations'),{recursive:true});
    const file=join(source,'supabase/migrations/0001_identity.sql');writeFileSync(file,'select 1;\n');
    execFileSync('xattr',['-w','com.apple.ResourceFork','synthetic-metadata',file]);
    const unsafeEnv={...process.env,LC_ALL:'C'};delete unsafeEnv.COPYFILE_DISABLE;
    const bad=join(root,'xattrs.tar.gz');execFileSync('tar',['-czf',bad,'-C',source,'.'],{env:unsafeEnv,stdio:'pipe'});
    assert.ok(listing(bad).includes('._0001_identity.sql'),'BSDtar fixture must reproduce AppleDouble emission');
    assert.throws(()=>validateArchiveListing(listing(bad)));
    // Exercise the actual local verifier with a separate temporary workspace, never production artifacts.
    const privateDir=join(root,'build/azure-core/private');mkdirSync(privateDir,{recursive:true});
    const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
    const body=Buffer.concat([cipher.update(readFileSync(bad)),cipher.final()]);
    const encrypted=Buffer.concat([nonce,cipher.getAuthTag(),body]);
    writeFileSync(join(privateDir,'fixture.enc'),encrypted);writeFileSync(join(privateDir,'migration-package-key.txt'),key.toString('base64'));
    writeFileSync(join(root,'build/azure-core/migration-package-receipt.json'),JSON.stringify({blobName:'fixture.enc',sha256:createHash('sha256').update(encrypted).digest('hex'),packageType:'schema-import',schemaSha256:'fixture'}));
    const check=spawnSync(process.execPath,[fileURLToPath(new URL('../migration/verify-package.mjs',import.meta.url))],{cwd:root,env:archiveEnv,encoding:'utf8'});
    assert.equal(check.status,1);assert.ok(check.stderr.includes('unsafe_archive_member'));assert.equal(check.stderr.includes('MODULE_NOT_FOUND'),false);assert.equal(check.stderr.includes(key.toString('base64')),false);
    const good=join(root,'portable.tar.gz');execFileSync('tar',['-czf',good,'-C',source,'.'],{env:archiveEnv,stdio:'pipe'});
    assert.equal(listing(good).includes('._0001_identity.sql'),false);assert.equal(validateArchiveListing(listing(good)).files,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('Functions ZIP excludes metadata and validates the raw ZIP member list',()=>{
  const root=mkdtempSync(join(tmpdir(),'academy-functions-zip-'));
  try{
    mkdirSync(join(root,'src/__MACOSX'),{recursive:true});writeFileSync(join(root,'src/index.mjs'),'export {};');
    writeFileSync(join(root,'src/._index.mjs'),'metadata');writeFileSync(join(root,'src/.DS_Store'),'metadata');writeFileSync(join(root,'src/__MACOSX/fixture'),'metadata');
    const archive=join(root,'functions.zip');
    execFileSync('zip',['-q','-r',archive,'src','-x','._*','*/._*','__MACOSX/*','*/__MACOSX/*','.DS_Store','*/.DS_Store'],{cwd:root,env:archiveEnv});
    const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'});assert.equal(validateArchiveListing(entries,{kind:'functions'}).files,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

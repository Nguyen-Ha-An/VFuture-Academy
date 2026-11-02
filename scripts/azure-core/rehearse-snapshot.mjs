#!/usr/bin/env node
// Rehearse a sensitive source export in disposable local PostgreSQL, without cloud writes.
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAzureSchema } from './schema.mjs';
import { restoreSnapshot } from './restore.mjs';
const runtime=process.env.PGLITE_MODULE_PATH;
if(!runtime)throw new Error('PGLITE_MODULE_PATH is required');
const {PGlite}=await import(pathToFileURL(resolve(runtime,'dist/index.js')).href);
const {pgcrypto}=await import(pathToFileURL(resolve(runtime,'dist/contrib/pgcrypto.js')).href);
const db=new PGlite({extensions:{pgcrypto}});
try{
  const artifact=buildAzureSchema();
  await db.exec(artifact.sql);
  const snapshot=JSON.parse(readFileSync(resolve('build/azure-core/private/source-snapshot.json'),'utf8'));
  const receipt=await restoreSnapshot(db,snapshot);
  writeFileSync(resolve('build/azure-core/source-rehearsal-receipt.json'),JSON.stringify({...receipt,checkedAt:new Date().toISOString(),engine:'PGlite local; not hosted acceptance'},null,2)+'\n',{mode:0o600});
  console.log('Source snapshot rehearsal passed, with full row and FK reconciliation; no cloud writes.');
}catch(error){console.error('Source snapshot rehearsal failed; no success receipt.', {mismatch:JSON.stringify(error.reconciliation), code:typeof error.code==='string'?error.code:'reconciliation', constraint:typeof error.constraint==='string'?error.constraint:undefined, check:!error.code&&/^(Snapshot|Restore|Verified|Invalid sequence)/.test(error.message)?error.message:undefined});process.exitCode=1;}
finally{await db.close();}

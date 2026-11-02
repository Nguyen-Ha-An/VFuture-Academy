#!/usr/bin/env node
// Execute only on an approved, unused Azure target from its private network.
import { createAzureTargetClient } from './target.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAzureSchema,buildAzureSchema } from './schema.mjs';
import { restoreSnapshot } from './restore.mjs';
import { safeDatabaseFailure } from './diagnostics.mjs';

export async function migrateMain(argv=process.argv.slice(2)){
const action=argv[0];
if(!['schema','import'].includes(action))throw new Error('Usage: node scripts/azure-core/migrate.mjs schema|import [--apply]');
const artifact=buildAzureSchema();
const directory=resolve('build/azure-core');mkdirSync(directory,{recursive:true,mode:0o700});
writeFileSync(resolve(directory,'azure-schema.sql'),artifact.sql,{mode:0o600});
writeFileSync(resolve(directory,'schema-receipt.json'),JSON.stringify(artifact.receipt,null,2)+'\n',{mode:0o600});
if(!argv.includes('--apply')) {
  console.log('Generated schema and migration receipt in ignored build/azure-core/. No database connection opened.');
}else{
  let db;
  try {
    db=createAzureTargetClient(process.env,{statement_timeout:120000});
    await db.connect();
    if(action==='schema') {
      const existing=await db.query("select count(*)::int n from pg_tables where schemaname in ('public','academy_identity','academy_private')");
      if(existing.rows[0].n!==0)throw new Error('Schema bootstrap requires an empty database');
      await applyAzureSchema(db,artifact);
      console.log('Azure schema applied. Configure restricted authenticator login and run import/reconciliation before activation.');
    }else{
      const snapshot=JSON.parse(readFileSync(resolve(directory,'private/source-snapshot.json'),'utf8'));
      const receipt=await restoreSnapshot(db,snapshot);
      writeFileSync(resolve(directory,'target-reconciliation.json'),JSON.stringify({...receipt,reconciledAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
      console.log(receipt.storageApiVerified ? 'Target import committed after full row, identity, actual Storage inventory and FK reconciliation.' : 'Target import committed; uploads remain disabled pending actual Storage API inventory verification.');
    }
  }catch(error){
    console.error(JSON.stringify(safeDatabaseFailure(error,'MIGRATION_FAILED',action)));
    process.exitCode=1;
  }finally{await db?.end();}
}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await migrateMain().catch(error=>{console.error(JSON.stringify(safeDatabaseFailure(error,'MIGRATION_FAILED',process.argv[2])));process.exitCode=1;});

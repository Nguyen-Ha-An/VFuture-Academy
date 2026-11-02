#!/usr/bin/env node
// Read-only source API export. Writes sensitive records only beneath ignored build/.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAzureSchema } from './schema.mjs';
import { inventoryStorage, snapshotReceipt } from './snapshot.mjs';

async function main() {
  if(process.env.MIGRATION_SOURCE_QUIESCED!=='1') throw new Error('Freeze source writes and native upload tokens before export; set MIGRATION_SOURCE_QUIESCED=1 only after that release gate is met');
  const sourceUrl=process.env.SOURCE_SUPABASE_URL;
  const key=process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
  if(!sourceUrl||!key||new URL(sourceUrl).protocol!=='https:') throw new Error('Read-only source export credentials missing');
  const db=createClient(sourceUrl,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {receipt}=buildAzureSchema();
  const catalog=JSON.parse(readFileSync(resolve('build/azure-core/local-rehearsal.json'),'utf8'));
  if(catalog.schemaSha256!==receipt.schemaSha256) throw new Error('Run current local rehearsal before export');
  async function snapshot() {
    const tables={};
    for(const name of catalog.tables) {
      const rows=[];
      for(let offset=0;;offset+=500) {
        let query=db.from(name).select('*').range(offset,offset+499);
        for(const column of catalog.primaryKeys[name]??[]) query=query.order(column);
        if(!catalog.primaryKeys[name]?.length) throw new Error(`No deterministic export ordering: ${name}`);
        const result=await query;
        if(result.error||!result.data) throw new Error(`Read-only source table export failed: ${name}`);
        rows.push(...result.data);
        if(result.data.length<500)break;
      }
      tables[name]=rows;
    }
    const now=Date.now();
    if((tables.media_upload_reservations??[]).some(row=>!row.released_at&&Date.parse(row.retain_until)>now)) throw new Error('Unexpired direct-upload tokens require quarantine before cutover export');
    if((tables.notebook_artifacts??[]).some(row=>row.status==='pending'&&Date.parse(row.created_at)+125*60000>now)) throw new Error('Unexpired notebook upload tokens require quarantine before cutover export');
    const users=[];
    for(let page=1;;page++) {
      const result=await db.auth.admin.listUsers({page,perPage:100});
      if(result.error)throw new Error('Read-only identity export failed');
      for(const user of result.data.users) users.push({id:user.id,email:user.email??null,raw_user_meta_data:user.user_metadata??{},created_at:user.created_at});
      if(result.data.users.length<100)break;
    }
    const storage=await inventoryStorage(db.storage);
    // PostgREST cannot expose sequence state. The operator must read this small
    // projection through a read-only SQL connector during the same write freeze.
    const sequences=JSON.parse(readFileSync(resolve('build/azure-core/source-sequences.json'),'utf8'));
    return {format:1,schemaSha256:receipt.schemaSha256,tables,users,storage,sequences};
  }
  const first=await snapshot();
  const second=await snapshot();
  if(JSON.stringify(snapshotReceipt(first))!==JSON.stringify(snapshotReceipt(second))) throw new Error('Source changed during export; restore write freeze and repeat');
  const output=resolve('build/azure-core');mkdirSync(output,{recursive:true,mode:0o700});
  mkdirSync(resolve(output,'private'),{recursive:true,mode:0o700});
  writeFileSync(resolve(output,'private/source-snapshot.json'),JSON.stringify(second),{mode:0o600});
  writeFileSync(resolve(output,'source-receipt.json'),JSON.stringify({...snapshotReceipt(second),capturedAt:new Date().toISOString(),consistency:'operator-confirmed write freeze plus two matching paginated API reads; not a database snapshot'},null,2)+'\n',{mode:0o600});
  console.log('Source export complete; sensitive snapshot and nonsecret counts/hashes receipt are under ignored build/azure-core/.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Export failed');process.exitCode=1;});

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeTarget } from '../migration/probe.mjs';
test('target probe uses read-only transaction and reports only approved operational fields',async()=>{
  const sql=[];
  const db={query:async query=>{
    sql.push(query);
    if(query.includes("current_setting('server_version_num')"))return{rows:[{version:'170011',extension_allowlist:'PGCRYPTO',read_only:'on'}]};
    if(query.startsWith('select tablename'))return{rows:[{tablename:'profiles'}]};
    if(query.includes('from pg_tables'))return{rows:[{schemaname:'public',table_count:63}]};
    if(query.includes('from pg_extension'))return{rows:[{extname:'pgcrypto',extversion:'1.3'}]};
    if(query.includes('from pg_roles'))return{rows:[{rolname:'academy_authenticator',rolcanlogin:false}]};
    if(query.includes('to_regclass'))return{rows:[{ledger:true,users:true,mappings:true,storage_receipts:true}]};
    if(query.includes('select state,schema_sha256'))return{rows:[{state:'prepared',schema_sha256:null}]};
    if(query.includes('count(*)'))return{rows:[{n:'0'}]};
    return{rows:[]};
  }};
  const result=await probeTarget(db);
  assert.equal(sql[0],'begin read only');assert.equal(sql.at(-1),'rollback');assert.equal(result.readOnly,true);assert.equal(result.ledger[0].state,'prepared');assert.equal(result.counts.users,0);assert.equal(result.publicTableRows.profiles,0);
  assert.equal(sql.some(q=>/\b(insert|update|delete|create|alter|drop|truncate)\b/i.test(q)),false);
  assert.equal(sql.some(q=>/rolpassword|email|raw_user_meta_data/.test(q)),false);
});
test('probe always rolls back its read-only transaction on error',async()=>{
  const sql=[];const db={query:async q=>{sql.push(q);if(q.startsWith('select')){const e=new Error('private driver content');e.code='42501';throw e;}return{rows:[]};}};
  await assert.rejects(probeTarget(db));assert.equal(sql[0],'begin read only');assert.equal(sql.at(-1),'rollback');
});

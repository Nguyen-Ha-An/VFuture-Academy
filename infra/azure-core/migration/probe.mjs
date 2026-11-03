import { createAzureTargetClient } from '../../../scripts/azure-core/target.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function probeTarget(db) {
  await db.query('begin read only');
  try {
    await db.query("set local statement_timeout='15000ms'");
    const server=(await db.query("select current_setting('server_version_num') as version, current_setting('azure.extensions',true) as extension_allowlist, current_setting('transaction_read_only') as read_only")).rows[0];
    const tables=(await db.query("select schemaname,count(*)::int as table_count from pg_tables where schemaname in ('public','academy_identity','academy_private') group by schemaname order by schemaname")).rows;
    const extensions=(await db.query("select extname,extversion from pg_extension where extname in ('pgcrypto','uuid-ossp') order by extname")).rows;
    const roles=(await db.query("select rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolvaliduntil from pg_roles where rolname in ('academy_authenticator','authenticated','service_role','anon') order by rolname")).rows;
    const existence=(await db.query("select to_regclass('academy_private.migration_state') is not null as ledger, to_regclass('academy_identity.users') is not null as users, to_regclass('academy_identity.mappings') is not null as mappings, to_regclass('academy_private.storage_inventory_receipts') is not null as storage_receipts")).rows[0];
    const ledger=existence.ledger?(await db.query("select state,schema_sha256 from academy_private.migration_state where singleton")).rows:[];
    const counts={};
    const publicTableRows={};
    const publicTables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    for(const row of publicTables){if(!/^[a-z][a-z0-9_]{0,62}$/.test(row.tablename))throw new Error('unexpected_table_name');publicTableRows[row.tablename]=Number((await db.query('select count(*) as n from public.\"'+row.tablename+'\"')).rows[0].n);}
    if(existence.users)counts.users=Number((await db.query('select count(*) as n from academy_identity.users')).rows[0].n);
    if(existence.mappings)counts.mappings=Number((await db.query('select count(*) as n from academy_identity.mappings')).rows[0].n);
    if(existence.storage_receipts)counts.storageInventoryReceipts=Number((await db.query('select count(*) as n from academy_private.storage_inventory_receipts')).rows[0].n);
    await db.query('rollback');
    return {format:1,action:'probe',observedAt:new Date().toISOString(),readOnly:server.read_only==='on',serverVersionNumber:server.version,extensionAllowlist:server.extension_allowlist,installedExtensions:extensions,schemaTableCounts:tables,roles,ledger,counts,publicTableRows};
  } catch(error) { await db.query('rollback'); throw error; }
}
async function main(){
  let db;
  try {
    db=createAzureTargetClient(process.env,{statement_timeout:15000});
    await db.connect();
    console.log(JSON.stringify(await probeTarget(db)));
  }catch(error){console.error(JSON.stringify({errorCode:'PROBE_FAILED',sqlState:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null,runtimeCode:['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN'].includes(error?.code)?error.code:null}));process.exitCode=1;}
  finally{await db?.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

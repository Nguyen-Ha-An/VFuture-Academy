import { snapshotReceipt, canonical, tableDigest } from './snapshot.mjs';
import { buildAzureSchema } from './schema.mjs';
const quote = name => '"'+name.replaceAll('"','""')+'"';
export async function databaseCatalog(db) {
  const rows=(await db.query(`select t.tablename, coalesce((select json_agg(a.attname order by k.ordinality) from pg_index i
    join lateral unnest(i.indkey) with ordinality k(attnum,ordinality) on true join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
    where i.indrelid=(quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass and i.indisprimary),'[]'::json) as keys
    from pg_tables t where schemaname='public' order by tablename`)).rows;
  return {tables:rows.map(row=>row.tablename),primaryKeys:Object.fromEntries(rows.map(row=>[row.tablename,row.keys]))};
}
function rejectUnsafeNumbers(value) {
  if(typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))) throw new Error('Snapshot contains a number that JSON cannot preserve safely');
  if(value&&typeof value==='object') for(const child of Object.values(value))rejectUnsafeNumbers(child);
}
export async function restoreSnapshot(db,snapshot) {
  rejectUnsafeNumbers(snapshot);
  if(snapshot.format!==1||snapshot.schemaSha256!==buildAzureSchema().receipt.schemaSha256)throw new Error('Snapshot schema version mismatch');
  const catalog=await databaseCatalog(db);
  if(JSON.stringify(Object.keys(snapshot.tables).sort())!==JSON.stringify(catalog.tables))throw new Error('Snapshot table catalog mismatch');
  const occupied=await db.query('select (select count(*) from academy_identity.users)+(select count(*) from academy_identity.mappings) as n');
  const state=(await db.query('select state from academy_private.migration_state where singleton')).rows[0]?.state;
  if(state!=='prepared'||Number(occupied.rows[0].n)!==0)throw new Error('Restore requires an unused target; never overwrite an active Academy database');
  const sequenceNames=(await db.query("select sequencename from pg_sequences where schemaname='public' order by sequencename")).rows.map(row=>row.sequencename);
  if(!Array.isArray(snapshot.sequences)||JSON.stringify(snapshot.sequences.map(row=>row.name).sort())!==JSON.stringify(sequenceNames)) throw new Error('Verified sequence states are required');
  for(const sequence of snapshot.sequences)if(!/^[0-9]+$/.test(String(sequence.last_value))||typeof sequence.is_called!=='boolean')throw new Error('Invalid sequence state');
  await db.query('begin');
  try {
    const relations=['academy_identity.users',...catalog.tables.map(name=>'public.'+quote(name))];
    const foreignKeys=(await db.query(`select c.conname,n.nspname,t.relname,c.condeferrable,c.condeferred from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname in ('public','academy_identity')`)).rows;
    for(const relation of relations) await db.query(`alter table ${relation} disable trigger user`);
    for(const fk of foreignKeys)await db.query(`alter table ${quote(fk.nspname)}.${quote(fk.relname)} alter constraint ${quote(fk.conname)} deferrable initially deferred`);
    await db.query(`truncate ${relations.join(',')} cascade`);
    await db.query('insert into academy_identity.users select * from json_populate_recordset(null::academy_identity.users,$1::json)',[JSON.stringify(snapshot.users)]);
    for(const name of catalog.tables) {
      const columns=(await db.query("select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped and attgenerated='' order by attnum",['public.'+quote(name)])).rows.map(row=>quote(row.attname)).join(',');
      await db.query(`insert into public.${quote(name)} (${columns}) select ${columns} from json_populate_recordset(null::public.${quote(name)},$1::json)`,[JSON.stringify(snapshot.tables[name])]);
    }
    await db.query('set constraints all immediate');
    for(const fk of foreignKeys)await db.query(`alter table ${quote(fk.nspname)}.${quote(fk.relname)} alter constraint ${quote(fk.conname)} ${fk.condeferrable?'deferrable':'not deferrable'} initially ${fk.condeferred?'deferred':'immediate'}`);
    for(const relation of relations) await db.query(`alter table ${relation} enable trigger user`);
    for(const item of snapshot.storage)await db.query('insert into academy_private.storage_objects(bucket_id,name,metadata) values($1,$2,$3)',[item.bucket_id,item.name,item.metadata]);
    const receipt=snapshotReceipt(snapshot);
    const storageVerified=snapshot.storageVerification?.source==='supabase-storage-api'&&snapshot.storageVerification?.sha256===receipt.storage.sha256&&snapshot.storageVerification?.privateBuckets===true;
    if(storageVerified) await db.query('insert into academy_private.storage_inventory_receipts(singleton,reconciled_at,object_count,inventory_sha256) values(true,now(),$1,$2)',[snapshot.storage.length,receipt.storage.sha256]);
    const actual={...snapshot,tables:{},users:[],storage:[]};
    for(const name of catalog.tables)actual.tables[name]=(await db.query(`select to_json(t) as row from public.${quote(name)} t`)).rows.map(row=>row.row);
    actual.users=(await db.query("select jsonb_build_object('id',id,'email',email,'raw_user_meta_data',raw_user_meta_data,'created_at',created_at) as row from academy_identity.users")).rows.map(row=>row.row);
    actual.storage=(await db.query('select bucket_id,name,metadata from academy_private.storage_objects')).rows;
    const actualReceipt=snapshotReceipt(actual);
    if(JSON.stringify(canonical(actualReceipt))!==JSON.stringify(canonical(receipt))) {
      const mismatch=Object.keys(receipt.tables).filter(name=>JSON.stringify(actualReceipt.tables[name])!==JSON.stringify(receipt.tables[name]));
      const details=Object.fromEntries(mismatch.map(name=>[name,Object.keys(snapshot.tables[name][0]??{}).filter(column=>tableDigest(snapshot.tables[name].map(row=>({value:row[column]})))!==tableDigest(actual.tables[name].map(row=>({value:row[column]}))))]));
      const error=new Error('Restore checksum reconciliation failed; transaction rolled back');
      error.reconciliation={tables:details,users:JSON.stringify(receipt.users)!==JSON.stringify(actualReceipt.users),storage:JSON.stringify(receipt.storage)!==JSON.stringify(actualReceipt.storage)};
      throw error;
    }
    for(const sequence of snapshot.sequences)await db.query('select setval($1::regclass,$2::bigint,$3)', ['public.'+quote(sequence.name),sequence.last_value,sequence.is_called]);
    await db.query("update academy_private.migration_state set state='imported',schema_sha256=$1,imported_at=now() where singleton",[snapshot.schemaSha256]);
    await db.query('commit');
    return {...actualReceipt,storageApiVerified:storageVerified};
  }catch(error){await db.query('rollback');throw error;}
}

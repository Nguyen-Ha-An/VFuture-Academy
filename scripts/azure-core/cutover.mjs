// Operator-only private-network actions. Private manifests never enter Git or receipts.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAzureTargetClient } from './target.mjs';
import { canonical, snapshotReceipt, tableDigest } from './snapshot.mjs';

const customer='f3152aa5-61de-40fd-bb76-780b9fbe5428';
const workforce='157419c9-2de9-45e7-a6f9-91546dbef629';
const issuer=`https://${customer}.ciamlogin.com/${customer}/v2.0`;
const staffIssuer=`https://login.microsoftonline.com/${workforce}/v2.0`;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const quoted=name=>{if(!/^[a-z][a-z0-9_]*$/.test(name))throw new Error('Invalid owned identifier');return '"'+name+'"';};

export function validateCutoverManifest(manifest,snapshot,now=Date.now()) {
  if(manifest.format!==1||manifest.sourceProject!=='czmahomzcspvtddvqium'||!Array.isArray(manifest.mappings)||!manifest.mappings.length||manifest.mappings.length>1000
    ||!Number.isFinite(Date.parse(manifest.reviewedAt))||now-Date.parse(manifest.reviewedAt)>86400000||Date.parse(manifest.reviewedAt)>now+30000)throw new Error('Invalid or stale mapping manifest');
  const users=new Map(snapshot.users.map(user=>[user.id,user]));const seen=new Set();
  for(const mapping of manifest.mappings){
    const proof=mapping.proof;const user=users.get(mapping.userId);
    if(!uuid.test(mapping.userId)||!uuid.test(mapping.subject)||!user||!proof||seen.has(mapping.issuer+mapping.subject))throw new Error('Invalid identity mapping');
    seen.add(mapping.issuer+mapping.subject);
    if(mapping.issuer===issuer){
      if(proof.kind!=='legacy-google-subject'||!/^\d{6,255}$/.test(proof.legacySubject)||proof.legacySubject!==proof.targetSubject||proof.sourceEmailVerified!==true)throw new Error('Google immutable identity evidence required');
    }else if(mapping.issuer===staffIssuer){
      // This is an explicit operator migration from the source's verified workforce
      // identity and authoritative directory UPN, never browser email auto-linking.
      if(proof.kind!=='verified-workforce-upn'||proof.legacyTenant!==workforce||proof.targetTenant!==workforce||proof.sourceEmailVerified!==true||proof.sourceDomainOwnerVerified!==true||proof.targetAccountEnabled!==true
        ||typeof user.email!=='string'||proof.legacyEmail?.toLowerCase()!==user.email.toLowerCase()||proof.targetUpn?.toLowerCase()!==user.email.toLowerCase())throw new Error('Verified workforce evidence required');
    }else throw new Error('Unapproved identity issuer');
  }
  return manifest;
}

export async function applyCutover(db,action,manifest,snapshot) {
  validateCutoverManifest(manifest,snapshot);
  if(!['map-identities','final-sync'].includes(action))throw new Error('Invalid cutover action');
  if(action==='final-sync'&&(manifest.sourceWriteFreeze!==true||!Number.isFinite(Date.parse(manifest.frozenAt))||Date.now()-Date.parse(manifest.frozenAt)>3600000))throw new Error('Fresh source write-freeze receipt required');
  await db.query('begin');
  try {
    await db.query("set local lock_timeout='5s'");
    await db.query("select pg_advisory_xact_lock(hashtextextended('academy-cutover',0))");
    const users=(await db.query('select id,email,disabled_at,deleted_at from academy_identity.users order by id for update')).rows;
    if(!same(users.map(u=>u.id).sort(),snapshot.users.map(u=>u.id).sort())||users.some(u=>u.disabled_at||u.deleted_at||u.email!==snapshot.users.find(s=>s.id===u.id)?.email))throw new Error('Target user universe changed; reconciliation required');
    let inserted=0;
    for(const mapping of manifest.mappings){
      await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[mapping.issuer+':'+mapping.subject]);
      const existing=(await db.query('select user_id from academy_identity.mappings where issuer=$1 and subject=$2',[mapping.issuer,mapping.subject])).rows[0];
      if(existing&&existing.user_id!==mapping.userId)throw new Error('Identity already belongs to another account');
      if(!existing){await db.query('insert into academy_identity.mappings(issuer,subject,user_id) values($1,$2,$3)',[mapping.issuer,mapping.subject,mapping.userId]);inserted++;}
      if(mapping.issuer===staffIssuer&&!(await db.query('select public.academy_identity_find_staff($1,$2) as staff',[mapping.issuer,mapping.subject])).rows[0]?.staff)throw new Error('Microsoft identity has no current staff permission');
    }
    let reconciled=null;
    if(action==='final-sync'){
      const names=Object.keys(snapshot.tables).sort();
      const catalog=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
      if(!same(names,catalog))throw new Error('Public catalog changed');
      const tables={};
      for(const name of names){
        await db.query(`lock table public.${quoted(name)} in share row exclusive mode`);
        const rows=(await db.query(`select to_json(t) as row from public.${quoted(name)} t`)).rows.map(r=>r.row);
        // Only short-lived request counters can differ. Never overwrite new course,
        // exam, grade, profile, audit or other business writes in the Azure copy.
        if(name!=='rate_limits'&&tableDigest(rows)!==tableDigest(snapshot.tables[name]))throw new Error('Business data differs; reconciliation required');
        tables[name]=rows;
      }
      await db.query('delete from public.rate_limits');
      await db.query('insert into public.rate_limits select * from json_populate_recordset(null::public.rate_limits,$1::json)',[JSON.stringify(snapshot.tables.rate_limits)]);
      tables.rate_limits=snapshot.tables.rate_limits;
      for(const user of snapshot.users)await db.query('update academy_identity.users set raw_user_meta_data=$2::jsonb where id=$1',[user.id,JSON.stringify(user.raw_user_meta_data)]);
      const actualUsers=(await db.query("select jsonb_build_object('id',id,'email',email,'raw_user_meta_data',raw_user_meta_data,'created_at',created_at) as row from academy_identity.users")).rows.map(r=>r.row);
      const storage=(await db.query('select bucket_id,name,metadata from academy_private.storage_objects')).rows;
      const before=snapshotReceipt({...snapshot,tables,users:actualUsers,storage});
      if(!same(before,snapshotReceipt(snapshot)))throw new Error('Final row or inventory reconciliation failed');
      for(const sequence of snapshot.sequences){
        if(!['analytics_events_id_seq','audit_log_id_seq'].includes(sequence.name)||!/^\d+$/.test(sequence.last_value)||typeof sequence.is_called!=='boolean')throw new Error('Invalid sequence receipt');
        const current=(await db.query(`select last_value::text,is_called from public.${quoted(sequence.name)}`)).rows[0];
        if(BigInt(current.last_value)>BigInt(sequence.last_value))throw new Error('Target sequence advanced beyond source; reconciliation required');
        await db.query('select setval($1::regclass,$2::bigint,$3)',['public.'+quoted(sequence.name),sequence.last_value,sequence.is_called]);
      }
      reconciled=before;
    }
    await db.query('commit');
    return {action,mappings:manifest.mappings.length,inserted,completedAt:new Date().toISOString(),...(reconciled?{reconciliation:reconciled}:{})};
  }catch(error){await db.query('rollback');throw error;}
}

async function main(){
  const manifestText=readFileSync('build/azure-core/private/cutover-manifest.json','utf8');
  const manifest=JSON.parse(manifestText);const snapshot=JSON.parse(readFileSync('build/azure-core/private/source-snapshot.json','utf8'));
  validateCutoverManifest(manifest,snapshot);
  if(process.argv[2]==='validate'){console.log(JSON.stringify({valid:true,mappings:manifest.mappings.length}));return;}
  const db=createAzureTargetClient(process.env,{statement_timeout:120000});await db.connect();
  try {const result=await applyCutover(db,process.argv[2],manifest,snapshot);console.log(JSON.stringify({...result,manifestSha256:createHash('sha256').update(manifestText).digest('hex')}));}
  finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({errorCode:'CUTOVER_FAILED',sqlState:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null}));process.exitCode=1;});

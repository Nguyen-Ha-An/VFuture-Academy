#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

export const fixture = `create role anon; create role authenticated; create role service_role;
create schema storage;
create table storage.objects (bucket_id text, name text, metadata jsonb, unique(bucket_id,name));
create table public.media_assets (id text primary key,owner_id uuid,bucket text,path text,purpose text,item_id text,mime text,size_bytes bigint,width int,height int);
create table public.profiles(id uuid primary key,avatar_url text);`;
export const migration = join(repositoryRoot, 'supabase/migrations/20261025140618_academy_media_upload_reservations.sql');
export const reservationSql = 'select public.media_upload_reserve($1::uuid,$2::uuid,$3::text,$4::jsonb) as r';
export const metadata = { name: 'work.txt', size: 8, mime: 'text/plain', checksum: 'a'.repeat(64), purpose: 'submission', courseId: 'course', itemId: 'item', blockId: null };
export async function verifyMediaReservations(db) {
  await db.exec(fixture);
  await db.exec(readFileSync(migration, 'utf8'));
  const owner = randomUUID(), id = randomUUID();
  const reserve = async (who = owner, key = randomUUID(), data = metadata) => (await db.query(reservationSql, [who, key, `asset_${key.replaceAll('-', '')}`, data])).rows[0].r;
  const rpc = async (action, who, key, lease = null, extra = {}) => (await db.query('select public.media_upload_transition($1,$2,$3,$4,$5) as r', [who,key,action,lease,extra])).rows[0].r;
  const object = async (r, path = r.pending_path) => db.query('insert into storage.objects values($1,$2,$3)', [r.bucket,path,{size:r.size_bytes,mimetype:r.mime}]);
  const a = await reserve(owner,id);
  assert.equal(a.owner_id, owner); assert.equal(a.size_bytes,8);
  assert.ok(a.pending_path.includes(id)); assert.ok(a.ready_path.includes(a.asset_id));
  assert.ok(new Date(a.retain_until) - new Date(a.expires_at) >= 125 * 60_000, 'quarantine covers a token issued at the very end of the reservation');
  assert.equal((await reserve(owner,id)).id,id, 'same id is idempotent');
  await assert.rejects(reserve(randomUUID(),id), /UPLOAD_NOT_FOUND/);
  await assert.rejects(reserve(owner,id,{...metadata, checksum:'b'.repeat(64)}), /UPLOAD_CONFLICT/);
  await assert.rejects(reserve(owner), /UPLOAD_ACTIVE/);
  await assert.rejects(rpc('get',randomUUID(),id), /UPLOAD_NOT_FOUND/);
  const tokenExpiry=new Date(Date.now()+4*60*60_000).toISOString();
  const signed=await rpc('signed',owner,id,null,{expiresAt:tokenExpiry});
  assert.ok(Date.parse(signed.retain_until)>=Date.parse(tokenExpiry)+5*60_000,'actual Storage token expiry extends quarantine');
  await object(a);
  await db.exec('update public.media_upload_limits set capacity_bytes=16');
  await assert.rejects(reserve(randomUUID()), /UPLOAD_CAPACITY/);
  await db.exec('update public.media_upload_limits set capacity_bytes=10737418240');
  const claimed = await rpc('claim',owner,id);
  await assert.rejects(rpc('claim',owner,id), /UPLOAD_BUSY/);
  await assert.rejects(rpc('cancel',owner,id), /UPLOAD_BUSY/);
  await assert.rejects(rpc('complete',owner,id,randomUUID()), /UPLOAD_BUSY/);
  await assert.rejects(rpc('complete',owner,id,claimed.lease_token), /UPLOAD_NOT_FOUND/);
  await object(a,a.ready_path);
  const ready = await rpc('complete',owner,id,claimed.lease_token,{width:null,height:null});
  assert.equal(ready.state,'ready');
  assert.equal((await rpc('claim',owner,id)).asset_id,a.asset_id);
  assert.equal((await db.query('select count(*)::int n from media_assets')).rows[0].n,1);
  await assert.rejects(rpc('cancel',owner,id), /UPLOAD_FINALIZED/);
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,2, 'pending quarantine remains');
  assert.deepEqual((await db.query('select * from public.media_upload_cleanup_candidates(10)')).rows,[]);
  const b = await reserve(); await object(b);
  await rpc('cancel',owner,b.id);
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,3, 'cancel does not remove replay tombstone');
  const c = await reserve();
  await db.query("update media_upload_reservations set expires_at=now()-interval '1 minute' where id=$1",[c.id]);
  await assert.rejects(rpc('claim',owner,c.id), /UPLOAD_EXPIRED/);
  await rpc('cancel',owner,c.id);
  await db.exec('update public.media_upload_limits set capacity_bytes=48');
  await assert.rejects(reserve(randomUUID()), /UPLOAD_CAPACITY/, 'empty expired/cancelled reservation still covers a valid old token');
  await db.exec('update public.media_upload_limits set capacity_bytes=10737418240');
  await db.exec("update media_upload_reservations set retain_until=now()-interval '1 minute'");
  await assert.rejects(rpc('release',owner,c.id), /UPLOAD_BUSY/, 'quota release requires an owned cleanup lease');
  const candidates = (await db.query('select * from public.media_upload_cleanup_candidates(2)')).rows;
  assert.equal(candidates.length,2,'cleanup discovery bounded');
  for (const r of [a,b,c]) {
    const cleanup = await rpc('cleanup',owner,r.id);
    if(r.id!==c.id) await assert.rejects(rpc('release',owner,r.id,cleanup.lease_token), /UPLOAD_BYTES_REMAIN/);
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[r.bucket,r.pending_path]);
    await rpc('release',owner,r.id,cleanup.lease_token);
  }
  assert.equal((await db.query('select count(*)::int n from media_assets')).rows[0].n,1);
  assert.equal((await db.query('select name from storage.objects')).rows[0].name,a.ready_path, 'final submission survives cleanup');
  // Existing imported/certificate/orphan objects participate in the shared capacity.
  await db.exec("insert into storage.objects values('certificates','existing.pdf','{\"size\":10737418240}')");
  await assert.rejects(reserve(randomUUID()), /UPLOAD_CAPACITY/);
  await db.exec("delete from storage.objects where bucket_id='certificates'");
  const avatarOwner=randomUUID();
  await db.query("insert into profiles values($1,'old-avatar')",[avatarOwner]);
  const avatar=await reserve(avatarOwner,randomUUID(),{name:'photo.png',size:8,mime:'image/png',checksum:'b'.repeat(64),purpose:'avatar'});
  await object(avatar);await object(avatar,avatar.ready_path);
  const avatarClaim=await rpc('claim',avatarOwner,avatar.id);
  await rpc('complete',avatarOwner,avatar.id,avatarClaim.lease_token,{width:1,height:1});
  assert.equal((await db.query('select avatar_url from profiles where id=$1',[avatarOwner])).rows[0].avatar_url,`/api/v1/media/${avatar.asset_id}`);
  const cover=await reserve(avatarOwner,randomUUID(),{name:'cover.png',size:8,mime:'image/png',checksum:'b'.repeat(64),purpose:'project_cover'});
  await object(cover);await object(cover,cover.ready_path);
  const coverClaim=await rpc('claim',avatarOwner,cover.id);
  await rpc('complete',avatarOwner,cover.id,coverClaim.lease_token,{width:2,height:1});
  assert.equal((await db.query('select avatar_url from profiles where id=$1',[avatarOwner])).rows[0].avatar_url,`/api/v1/media/${avatar.asset_id}`,'cover completion never changes avatar');
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(reserve(), e=>e.code==='42501'); await assert.rejects(db.query('select * from media_upload_reservations'), e=>e.code==='42501'); }
    finally { await db.exec('reset role'); }
  }
  console.log('Media upload SQL passed: owner binding, idempotency, active slot, capacity, leases, expiry quarantine, bounded cleanup, retained ready submission and ACLs.');
}
if (process.argv[1]?.endsWith('verify-media-upload-reservations.mjs') && !process.argv.includes('--native') && !process.argv.includes('--full-chain')) {
  const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH ?? process.env.PGLITE_RUNTIME);
  const db = new loaded.PGlite();
  try { await verifyMediaReservations(db); } finally { await db.close(); if(loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix,{recursive:true,force:true}); }
}

/** Real overlapping PostgreSQL transactions; no hosted connection or TCP listener. */
export async function verifyMediaReservationConcurrency() {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { discoverStudioPostgresBinaries, createStudioFixtureClient } = await import('./lib/studio-postgres-fixture.mjs');
  const root = mkdtempSync('/tmp/vf-media-pg.');
  const data = join(root,'data'), socket = join(root,'socket'); mkdirSync(socket);
  const found = discoverStudioPostgresBinaries(); const clients=[]; let started=false;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(PG|SUPABASE_|NEXT_PUBLIC_SUPABASE_|DATABASE_URL$)/.test(key)));
  const run=(name,args)=>execFileSync(join(found.bin,name),args,{env,stdio:'pipe'});
  try {
    run('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale']);
    run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-F -c listen_addresses='' -k ${socket}`,'-w','start']);started=true;
    for(let i=0;i<13;i++){const client=createStudioFixtureClient({host:socket,user:'postgres',database:'postgres'});await client.connect();clients.push(client);}
    const db=clients[0];await db.query(fixture);await db.query(readFileSync(migration,'utf8'));
    const owner=randomUUID();
    const reserve=(client,who=owner,key=randomUUID())=>client.query(reservationSql,[who,key,`asset_${key.replaceAll('-','')}`,metadata]);
    const first=await Promise.allSettled(clients.slice(1).map(c=>reserve(c)));
    assert.equal(first.filter(r=>r.status==='fulfilled').length,1,'one active owner winner across real connections');
    const row=first.find(r=>r.status==='fulfilled').value.rows[0].r;
    await db.query('update media_upload_limits set capacity_bytes=32');
    const capacity=await Promise.allSettled(clients.slice(1).map(c=>reserve(c,randomUUID())));
    assert.equal(capacity.filter(r=>r.status==='fulfilled').length,1,'exactly one remaining quota slot');
    const claims=await Promise.allSettled(clients.slice(1).map(c=>c.query("select public.media_upload_transition($1,$2,'claim') r",[owner,row.id])));
    assert.equal(claims.filter(r=>r.status==='fulfilled').length,1,'exactly one finalize lease');
    const claim=claims.find(r=>r.status==='fulfilled').value.rows[0].r;
    await db.query('insert into storage.objects values($1,$2,$4),($1,$3,$4)',[row.bucket,row.pending_path,row.ready_path,{size:8,mimetype:'text/plain'}]);
    const finish=await Promise.allSettled(clients.slice(1,12).map(c=>c.query("select public.media_upload_transition($1,$2,'complete',$3,'{}') r",[owner,row.id,claim.lease_token])));
    assert.ok(finish.every(r=>r.status==='fulfilled'));
    assert.equal((await db.query('select count(*)::int n from media_assets')).rows[0].n,1,'concurrent finalize publishes one asset');
    await assert.rejects(db.query("select public.media_upload_transition($1,$2,'cancel')",[owner,row.id]),/UPLOAD_FINALIZED/);
    // Hold admission open in one transaction and prove another waits on its lock.
    await db.query('truncate media_upload_reservations,media_assets,storage.objects');
    await db.query('update media_upload_limits set capacity_bytes=16');
    await clients[1].query('begin'); await reserve(clients[1],randomUUID());
    const waiting=reserve(clients[2],randomUUID());
    let observed=false;
    for(let n=0;n<100;n++){
      const locks=await db.query("select count(*)::int n from pg_locks where locktype='advisory' and not granted");
      if(locks.rows[0].n){observed=true;break;}await new Promise(r=>setTimeout(r,10));
    }
    assert.ok(observed,'second transaction really blocks on admission lock');
    await clients[1].query('rollback'); const admitted=(await waiting).rows[0].r;
    assert.equal((await db.query('select count(*)::int n from media_upload_reservations')).rows[0].n,1,'rollback preserves quota and lets waiter reserve');
    await db.query('update media_upload_limits set capacity_bytes=32');
    await db.query("update media_upload_reservations set expires_at=now()-interval '1 second' where id=$1",[admitted.id]);
    const replacements=await Promise.allSettled(clients.slice(1).map(c=>reserve(c,admitted.owner_id)));
    assert.equal(replacements.filter(r=>r.status==='fulfilled').length,1,'expired owner slot has one concurrent replacement');
    const tombstone=(await db.query('select state,released_at,retain_until from media_upload_reservations where id=$1',[admitted.id])).rows[0];
    assert.equal(tombstone.state,'cancelled');assert.equal(tombstone.released_at,null);
    assert.equal(new Date(tombstone.retain_until).toISOString(),new Date(admitted.retain_until).toISOString());
    await assert.rejects(reserve(db,randomUUID()),/UPLOAD_CAPACITY/,'native expired-slot race retains the old quota allocation');
    console.log('Native upload races passed: 12 competing owner reservations, capacity contenders, 12 finalize claims, 11 idempotent completions, proven blocking/rollback, and 12 expired-slot replacements with retained quota.');
  } finally {
    await Promise.all(clients.map(c=>c.end().catch(()=>undefined)));
    if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    rmSync(root,{recursive:true,force:true});if(found.temporaryRuntime)rmSync(found.temporaryRuntime,{recursive:true,force:true});
  }
}

if (process.argv[1]?.endsWith('verify-media-upload-reservations.mjs') && process.argv.includes('--native')) await verifyMediaReservationConcurrency();

/** Lifecycle recovery against the complete real migration chain, not replacement tables. */
export async function verifyMediaUploadLifecycle(db) {
  const owner=randomUUID(), id=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)',[owner,`${owner}@upload.test`]);
  const input={name:'photo.png',size:8,mime:'image/png',checksum:'a'.repeat(64),purpose:'avatar'};
  const reserve=async(key=id)=>(await db.query(reservationSql,[owner,key,`asset_${key.replaceAll('-','')}`,input])).rows[0].r;
  const rpc=async(action,key=id,lease=null,extra={})=>(await db.query('select public.media_upload_transition($1,$2,$3,$4,$5) r',[owner,key,action,lease,extra])).rows[0].r;
  const first=await reserve();
  const lost=await rpc('claim');
  await assert.rejects(reserve(),/UPLOAD_BUSY/,'a live worker retains its finalize lease');
  await db.query("update media_upload_reservations set lease_until=now()-interval '1 second' where id=$1",[id]);
  const recovered=await reserve();
  assert.equal(recovered.id,id);assert.equal(recovered.state,'reserved');assert.equal(recovered.lease_token,null);
  assert.equal(recovered.pending_path,first.pending_path);assert.equal(recovered.released_at,null);
  await assert.rejects(rpc('complete',id,lost.lease_token),/UPLOAD_BUSY/,'stale worker cannot publish after recovery');
  const fresh=await rpc('claim');
  assert.notEqual(fresh.lease_token,lost.lease_token);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[first.bucket,first.ready_path,{size:8,mimetype:'image/png'}]);
  const ready=await rpc('complete',id,fresh.lease_token,{width:1,height:1});
  assert.equal(ready.state,'ready');
  assert.equal((await db.query('select avatar_url from profiles where id=$1',[owner])).rows[0].avatar_url,`/api/v1/media/${first.asset_id}`);
  assert.equal((await db.query('select count(*)::int n from media_assets where id=$1',[first.asset_id])).rows[0].n,1);

  // Reload loses the client id: an expired reservation must relinquish only
  // admission, even while its token and absent-or-present bytes retain quota.
  for(const withObject of [false,true]) {
    const stale=await reserve(randomUUID());
    if(withObject) await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[stale.bucket,stale.pending_path,{size:8,mimetype:'image/png'}]);
    const oldLease=await rpc('claim',stale.id);
    await db.query("update media_upload_reservations set expires_at=now()-interval '1 second' where id=$1",[stale.id]);
    await assert.rejects(reserve(randomUUID()),/UPLOAD_ACTIVE/,'an unexpired worker lease still blocks replacement');
    await db.query("update media_upload_reservations set lease_until=now()-interval '1 second' where id=$1",[stale.id]);
    const replacement=await reserve(randomUUID());
    const retired=await rpc('get',stale.id);
    assert.equal(retired.state,'cancelled');assert.equal(retired.released_at,null);
    assert.equal(retired.retain_until,stale.retain_until,'slot retirement cannot shorten quarantine');
    assert.equal((await db.query('select count(*)::int n from media_upload_reservations where owner_id=$1 and state in (\'reserved\',\'finalizing\')',[owner])).rows[0].n,1);
    await assert.rejects(rpc('complete',stale.id,oldLease.lease_token),/UPLOAD_BUSY/);
    await assert.rejects(rpc('cleanup',stale.id),/UPLOAD_BUSY/,'quarantined token cannot be cleaned early');
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1 and name=$2',[stale.bucket,stale.pending_path])).rows[0].n,withObject?1:0);
    await rpc('cancel',replacement.id);
  }
  // The ready copy and four still-held stale/replacement reservations consume
  // exactly five two-copy allocations (80 bytes), despite just one active slot.
  await db.query('update media_upload_limits set capacity_bytes=80');
  await assert.rejects(reserve(randomUUID()),/UPLOAD_CAPACITY/,'retiring expired admission never frees retained quota');
  await db.query('update media_upload_limits set capacity_bytes=10737418240');
  console.log('Full-chain upload lifecycle passed: expired-finalizer recovery, stale lease fencing, actual asset/profile publication, reload replacement with/without bytes, live-lease exclusion, retained quota and quarantine.');
}

if(process.argv[1]?.endsWith('verify-media-upload-reservations.mjs') && process.argv.includes('--full-chain')) {
  const {createFullAdminDatabase}=await import('./verify-admin-migrations.mjs');
  const loaded=await loadPGlite(process.argv[2]==='--full-chain'?process.argv[3]:process.argv[2]??process.env.PGLITE_MODULE_PATH);
  const db=await createFullAdminDatabase(loaded.PGlite);
  try {await db.exec('alter table storage.objects add column if not exists metadata jsonb');await verifyMediaUploadLifecycle(db);}
  finally {await db.close();if(loaded.temporaryPrefix)rmSync(loaded.temporaryPrefix,{recursive:true,force:true});}
}

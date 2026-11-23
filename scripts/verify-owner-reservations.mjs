#!/usr/bin/env node
// Upgrade fixtures on disposable PostgreSQL. No provider credentials or Storage calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildAzureSchema } from './azure-core/schema.mjs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const previous = '20261106040000_management_teaching_scope.sql';
const migration = '20261120000400_limit_owner_reservations.sql';
const source = readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8');
const suffix = readFileSync(new URL('./azure-core/owner-reservations.sql', import.meta.url), 'utf8');
const mediaBytes = 100 * 1024 * 1024, notebookBytes = 20 * 1024 * 1024;
const digest = 'a'.repeat(64);
const input = { name: 'work.txt', size: 8, mime: 'text/plain', checksum: digest, purpose: 'submission' };

async function checkUpgrade(db, azure) {
  const owner = randomUUID(), other = randomUUID();
  await db.query(`insert into ${azure ? 'academy_identity' : 'auth'}.users(id,email)
    values($1,'first@example.test'),($2,'second@example.test')`, [owner, other]);
  await db.query("insert into public.courses(id,owner_id,status) values('capacity-fixture',$1,'draft')", [owner]);
  if (azure) await db.query('insert into academy_private.storage_inventory_receipts values(true,now(),0,$1)', [digest]);
  const notebook = async (who, id = randomUUID(), hoursOld = 0) => {
    const path = `pending/${who}/${id}/lesson.csv`;
    await db.query(`insert into public.notebook_artifacts(id,owner_id,course_id,item_id,purpose,checksum,
      runtime_profile_id,runtime_profile_version,size_bytes,mime,filename,storage_path,created_at)
      values($1,$2,'capacity-fixture','lesson','dataset',$3,'python','1',1,'text/csv','lesson.csv',$4,
        now()-make_interval(hours => $5))`, [id, who, digest, path, hoursOld]);
    return { id, path, ready: `ready/${who}/${id}/lesson.csv` };
  };
  const reserve = async (who, id = randomUUID()) => (await db.query(
    'select public.media_upload_reserve($1,$2,$3,$4) r', [who, id, `asset_${id.replaceAll('-', '')}`, input]
  )).rows[0].r;
  const transition = async (who, id, action, lease = null) => (await db.query(
    'select public.media_upload_transition($1,$2,$3,$4) r', [who, id, action, lease]
  )).rows[0].r;
  const sign = path => db.query("select public.academy_storage_reserve_signed('notebooks',$1)", [path]);
  const confirm = (who, path) => db.query("select public.confirm_notebook_upload_expiry($1,$2,now()+interval '6 hours')", [who, path]);
  const count = async (sql, args) => (await db.query(sql, args)).rows[0].n;

  // One retained media row and one finalized notebook already exist at rollout.
  const media = await reserve(owner);
  await transition(owner, media.id, 'cancel');
  const historical = await notebook(owner, randomUUID(), azure ? 6 : 1);
  if (azure) {
    await db.query(`insert into academy_private.storage_objects(bucket_id,name,metadata,retain_until,hold_kind)
      values('notebooks',$1,'{"size":1,"mimetype":"text/csv"}',now()+interval '1 hour','signed')`, [historical.path]);
  }
  await db.query('select public.finalize_notebook_artifact($1,$2,$3,$4,1)', [historical.id, owner, historical.ready, digest]);
  if (azure) {
    const portable = buildAzureSchema({ through: migration }).steps.find(step => step.id === `supabase/migrations/${migration}`);
    await db.exec(portable.sql);
    await db.exec(suffix);
  } else await db.exec(source);
  assert.equal(Number((await db.query('select owner_capacity_bytes from public.media_upload_limits where singleton')).rows[0].owner_capacity_bytes), 1024 ** 3);
  await db.query('update public.media_upload_limits set owner_capacity_bytes=$1', [mediaBytes + notebookBytes]);
  assert.equal(await count('select count(*)::int n from public.notebook_upload_reservations where pending_path=$1 and owner_id=$2', [historical.path, owner]), 1);
  const rejectedId = randomUUID();
  await assert.rejects(notebook(owner, rejectedId), /UPLOAD_OWNER_CAPACITY/);
  assert.equal(await count('select count(*)::int n from public.notebook_artifacts where id=$1', [rejectedId]), 0);
  await assert.rejects(reserve(owner), /UPLOAD_OWNER_CAPACITY/);
  await assert.rejects(transition(owner, media.id, 'cleanup'), /UPLOAD_BUSY/);

  const otherBook = await notebook(other);
  if (azure) {
    await sign(otherBook.path);
    await db.query("select public.academy_storage_confirm_signed('notebooks',$1,now()+interval '6 hours')", [otherBook.path]);
    assert.equal(await count(`select count(*)::int n from academy_private.storage_objects where bucket_id='notebooks'
      and name in ($1,$2) and retain_until >= now()+interval '6 hours'`, [otherBook.path, otherBook.ready]), 2);
  }
  const otherMedia = await reserve(other);
  assert.equal((await reserve(other, otherMedia.id)).id, otherMedia.id);
  await confirm(other, otherBook.path);
  await confirm(other, otherBook.path);
  await assert.rejects(confirm(owner, otherBook.path), /UPLOAD_EXPIRED/);
  assert.equal(await count(`select count(*)::int n from public.notebook_upload_reservations
    where pending_path=$1 and retain_until >= now()+interval '6 hours'`, [otherBook.path]), 1);

  await db.query("update public.media_upload_reservations set retain_until=now()-interval '1 minute' where id=$1", [media.id]);
  const cleanup = await transition(owner, media.id, 'cleanup');
  await transition(owner, media.id, 'release', cleanup.lease_token);
  const nextMedia = await reserve(owner);
  const claim = await transition(owner, nextMedia.id, 'claim');
  if (azure) await db.query('select public.academy_storage_observe($1,$2,$3)', [nextMedia.bucket, nextMedia.ready_path, { size: 8, mimetype: input.mime }]);
  else await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', [nextMedia.bucket, nextMedia.ready_path, { size: 8, mimetype: input.mime }]);
  await transition(owner, nextMedia.id, 'complete', claim.lease_token);
  await assert.rejects(notebook(owner), /UPLOAD_OWNER_CAPACITY/, 'ready media stays charged through fenced release');
  assert.equal((await reserve(owner, nextMedia.id)).state, 'ready');

  await db.query('update public.media_upload_limits set owner_capacity_bytes=$1,capacity_bytes=$2', [1024 ** 3, notebookBytes]);
  if (azure) {
    await sign(otherBook.path);
    assert.equal(await count("select count(*)::int n from academy_private.storage_objects where bucket_id='notebooks' and name=$1", [otherBook.path]), 1);
    await assert.rejects(notebook(other), /UPLOAD_CAPACITY/);
    await db.query('update public.media_upload_limits set capacity_bytes=10737418240,owner_capacity_bytes=$1', [mediaBytes + notebookBytes]);
    await db.query("select public.academy_storage_observe('notebooks',$1,$2)", [historical.path, { size: 1, mimetype: 'text/csv' }]);
    assert.equal((await db.query("select (metadata->>'size')::int n from academy_private.storage_objects where name=$1", [historical.path])).rows[0].n, notebookBytes / 2);
    await db.query("update academy_private.storage_objects set retain_until=now()-interval '1 minute' where name in ($1,$2)", [historical.path, historical.ready]);
  } else {
    await assert.rejects(notebook(other), /UPLOAD_CAPACITY/);
    await db.query('update public.media_upload_limits set capacity_bytes=10737418240,owner_capacity_bytes=$1', [mediaBytes + notebookBytes]);
  }
  await db.query("update public.notebook_upload_reservations set retain_until=now()-interval '1 minute' where pending_path=$1", [historical.path]);
  if (azure) {
    await assert.rejects(notebook(owner), /UPLOAD_OWNER_CAPACITY/, 'elapsed time alone cannot release a mirrored token hold');
    const result = await db.query(`select public.academy_storage_reconcile_hold(bucket_id,name,observed_at,null) ok
      from academy_private.storage_objects where bucket_id='notebooks' and name=$1`, [historical.path]);
    assert.equal(result.rows[0].ok, true);
    await assert.rejects(notebook(owner), /UPLOAD_OWNER_CAPACITY/, 'the remaining unverified copy still counts');
    const reconciledReady = await db.query(`select public.academy_storage_reconcile_hold(bucket_id,name,observed_at,$2) ok
      from academy_private.storage_objects where bucket_id='notebooks' and name=$1`, [historical.ready, { size: 1, mimetype: 'text/csv' }]);
    assert.equal(reconciledReady.rows[0].ok, true);
  }
  await notebook(owner);
  assert.equal(await count('select count(*)::int n from public.notebook_upload_reservations where pending_path=$1', [historical.path]), 0);
  if (azure) {
    const siteBytes = async () => Number((await db.query(`select
      (select coalesce(sum((metadata->>'size')::numeric),0) from academy_private.storage_objects)
      + (select count(*) * 104857600 from public.media_upload_reservations where released_at is null) as bytes`)).rows[0].bytes);
    const cap = (await siteBytes()) + notebookBytes;
    await db.query('update public.media_upload_limits set capacity_bytes=$1,owner_capacity_bytes=$2', [cap, 1024 ** 3]);
    const last = await notebook(other);
    await sign(last.path);
    assert.equal(await siteBytes(), cap);
    const write = (path, size, mime = 'text/csv') => db.query("select public.academy_storage_begin_write('notebooks',$1,$2,$3)", [path, size, mime]);
    await assert.rejects(write('unreserved/file.csv', 1), /UPLOAD_CAPACITY/);
    await assert.rejects(write(last.path, 1), /INVALID_UPLOAD/);
    await assert.rejects(write(last.ready, 1, 'application/json'), /INVALID_UPLOAD/);
    await assert.rejects(write(last.ready, 2), /INVALID_UPLOAD/);
    await write(last.ready, 1);
    await db.query("select public.academy_storage_observe('notebooks',$1,$2)", [last.ready, { size: 1, mimetype: 'text/csv' }]);
    await db.query('select public.finalize_notebook_artifact($1,$2,$3,$4,1)', [last.id, other, last.ready, digest]);
    await db.query("select public.academy_storage_observe('notebooks',$1,null)", [last.path]);
    assert.equal(await siteBytes(), cap, 'verified ready bytes and the still-replayable pending file fit the original allocation');
    assert.equal(await count("select count(*)::int n from public.notebook_artifacts where id=$1 and status='ready' and storage_path=$2", [last.id, last.ready]), 1);
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.notebook_upload_reservations'), /permission denied/);
    await assert.rejects(confirm(owner, historical.path), /permission denied/);
    await db.exec('reset role');
  }
}

const runtime = process.env.PGLITE_RUNTIME ?? process.env.PGLITE_MODULE_PATH;
if (!runtime) throw new Error('Set PGLITE_RUNTIME or PGLITE_MODULE_PATH to the installed SQL fixture runtime');
const { PGlite } = await loadPGlite(runtime);
const require = createRequire(import.meta.url);
const { pgcrypto } = require(require.resolve('@electric-sql/pglite/contrib/pgcrypto', { paths: [resolve(runtime)] }));
const classic = await createFullAdminDatabase(PGlite, { until: previous, hostedFunctionDefaults: true });
try { await checkUpgrade(classic, false); } finally { await classic.close(); }
const azure = new PGlite({ extensions: { pgcrypto } });
try {
  await azure.exec(buildAzureSchema({ through: previous }).sql);
  await checkUpgrade(azure, true);
} finally { await azure.close(); }
console.log('Owner reservation fixtures passed on classic and Azure PostgreSQL schemas.');

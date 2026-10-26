#!/usr/bin/env node
// Executes production SQL in disposable PostgreSQL only. PGlite serializes its
// client queue; overlapping native transactions are tested separately.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

const migration = join(repositoryRoot, 'supabase/migrations/20261025135531_shared_public_and_exam_admission.sql');
export const fixture = `
create role anon; create role authenticated; create role service_role;
create table public.exam_attempts (
 id uuid primary key, user_id uuid not null, course_version_id uuid not null,
 item_id text not null, attempt_no integer not null, status text not null,
 late boolean not null, question_set jsonb not null, grading_snapshot jsonb not null,
 started_at timestamptz not null, deadline_at timestamptz, submitted_at timestamptz,
 points numeric, max_points numeric, percent numeric,
 unique(user_id, course_version_id, item_id, attempt_no)
);
create table public.exam_answers (
 attempt_id uuid, user_id uuid, question_id text, answer jsonb, result jsonb,
 manual_points numeric, manual_feedback jsonb, graded_by uuid, updated_at timestamptz,
 primary key(attempt_id, question_id)
);`;
const version = '00000000-0000-4000-8000-000000000001';
const hash = (s) => createHash('sha256').update(s).digest('hex');
export const startSql = `select * from public.exam_start_attempt($1::uuid,$2::uuid,$3::uuid,'exam','{}','{}',now(),now()+interval '1 hour',2)`;
export async function verifySharedAdmission(db) {
  await db.exec(fixture);
  const legacy = readFileSync(join(repositoryRoot, 'supabase/migrations/0004_learning.sql'), 'utf8');
  await db.exec(legacy.slice(legacy.indexOf('create or replace function public.exam_start_attempt('), legacy.indexOf('create or replace function public.exam_append_attempt_events(')));
  await db.exec(readFileSync(join(repositoryRoot, 'supabase/migrations/0025_atomic_exam_attempt_writes.sql'), 'utf8'));
  await db.exec(readFileSync(migration, 'utf8'));
  const start = async (user = randomUUID()) => (await db.query(startSql, [randomUUID(), user, version])).rows[0];
  const reset = () => db.exec('truncate public.exam_attempts, public.exam_answers');
  // Existing hosted installs preserve admission until explicitly enabled.
  for (let i = 0; i < 26; i++) await start();
  await reset();
  await db.exec('update public.academy_runtime_limits set max_active_exam_attempts=25 where singleton');
  const active = await Promise.all(Array.from({ length: 25 }, () => start()));
  await assert.rejects(start(), (e) => e.code === 'P3002');
  assert.equal((await start(active[0].user_id)).id, active[0].id, 'full-capacity resume keeps original attempt');
  await db.exec('update public.academy_runtime_limits set new_exam_starts_paused=true where singleton');
  assert.equal((await start(active[0].user_id)).id, active[0].id, 'maintenance never blocks existing resume');
  await assert.rejects(start(), (e) => e.code === 'P3003');
  await db.exec('update public.academy_runtime_limits set new_exam_starts_paused=false where singleton');
  // Past-deadline rows remain active until the existing sweep finalization commits.
  await db.query("update public.exam_attempts set deadline_at=now()-interval '2 minutes' where id=$1", [active[0].id]);
  await assert.rejects(start(), (e) => e.code === 'P3002');
  const expired = await db.query(`select public.exam_finalize_attempt($1,'expired',true,now(),0,0,0,'{}','[]') as result`, [active[0].id]);
  assert.equal(expired.rows[0].result.transitioned, true);
  const retake = await start(active[0].user_id);
  assert.equal(retake.attempt_no, 2);
  assert.notEqual(retake.id, active[0].id);
  await db.query(`select public.exam_finalize_attempt($1,'expired',true,now(),0,0,0,'{}','[]')`, [retake.id]);
  await assert.rejects(start(active[0].user_id), (e) => e.code === 'P3001');
  // A burst competes for exactly the one released slot, never evicts an active row.
  const competing = await Promise.allSettled(Array.from({ length: 20 }, () => start()));
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await db.query("select count(*)::int as n from public.exam_attempts where status='in_progress'")).rows[0].n, 25);
  assert.equal((await db.query('select status from public.exam_attempts where id=$1', [active[1].id])).rows[0].status, 'in_progress');

  const claim = async (session, connection = 'school') => (await db.query('select public.public_rate_limit($1,$2) as result', [session ? hash(session) : null, hash(connection)])).rows[0].result;
  const clear = () => db.exec('truncate public.public_request_buckets');
  // Twenty-five authenticated anonymous cookies each receive all sixty requests.
  for (let n = 0; n < 60; n++) {
    for (let user = 0; user < 25; user++) assert.equal((await claim(`student-${user}`)).allowed, true);
  }
  assert.equal((await claim('student-0')).allowed, false);
  await clear();
  for (let n = 0; n < 60; n++) assert.equal((await claim('one', `ip-${n}`)).allowed, true);
  assert.equal((await claim('one', 'another-ip')).allowed, false, 'rotating IP does not bypass session');
  assert.equal((await claim('two')).allowed, true);
  await clear();
  for (let n = 0; n < 40; n++) assert.equal((await claim(null)).issueSession, n < 32);
  await clear();
  for (let n = 0; n < 129; n++) assert.equal((await claim(null, `new-ip-${n}`)).issueSession, n < 128);
  await clear();
  // Filling active storage never resets/evicts another live budget.
  await db.exec(`insert into public.public_request_buckets(key, started_at, count)
    select 'occupied:' || n, now(), 1 from generate_series(1,4096) n`);
  assert.equal((await claim('new-session')).allowed, false);
  assert.equal((await db.query('select count(*)::int as n from public.public_request_buckets')).rows[0].n, 4096);
  await clear();
  for (let n = 0; n < 3600; n++) assert.equal((await claim(`session-${n}`, `ip-${n % 10}`)).allowed, true);
  assert.equal((await claim('overflow', 'new-ip')).allowed, false, 'global budget survives independent callers');
  assert.ok((await db.query('select count(*)::int as n from public.public_request_buckets')).rows[0].n <= 4096);
  await db.exec("update public.public_request_buckets set started_at=now()-interval '61 seconds'");
  assert.equal((await claim('after-window')).allowed, true);
  await assert.rejects(db.query('select public.public_rate_limit($1,$2)', ['spoof', hash('school')]), (e) => e.code === '22023');
  const rights = await db.query(`select role_name, has_function_privilege(role_name,'public.public_rate_limit(text,text)','execute') as public_rpc,
    has_function_privilege(role_name,'public.exam_start_attempt(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz,timestamptz,integer)','execute') as start_rpc,
    has_table_privilege(role_name,'public.academy_runtime_limits','update') as config_write
    from unnest(array['anon','authenticated','service_role']) as role_name`);
  for (const row of rights.rows) {
    assert.equal(row.public_rpc, row.role_name === 'service_role');
    assert.equal(row.start_rpc, row.role_name === 'service_role');
    assert.equal(row.config_write, row.role_name === 'service_role');
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(claim('forbidden'), (e) => e.code === '42501');
      await assert.rejects(start(), (e) => e.code === '42501');
      await assert.rejects(db.exec('update public.academy_runtime_limits set max_active_exam_attempts=null'), (e) => e.code === '42501');
    } finally { await db.exec('reset role'); }
  }
  await db.exec('delete from public.academy_runtime_limits');
  await assert.rejects(start(), (e) => e.code === 'P3003', 'missing configuration fails closed');
  console.log('Shared admission SQL passed: 25-seat cap, resume, pause, sweep/retake, competing starts, school NAT, shared budgets, expiry, ACLs. PGlite queue is serialized; native transaction races are a separate check.');
}
if (process.argv[1]?.endsWith('verify-shared-admission.mjs')) {
  const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH ?? process.env.PGLITE_RUNTIME);
  const db = new loaded.PGlite();
  try { await verifySharedAdmission(db); } finally {
    await db.close();
    if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
  }
}

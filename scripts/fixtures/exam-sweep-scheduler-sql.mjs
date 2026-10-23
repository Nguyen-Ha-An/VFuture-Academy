import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../lib/studio-sql-runtime.mjs';

// Execute the real scheduler SQL against PostgreSQL semantics. Only the hosted
// extension interfaces are stubbed; this script cannot connect to production.
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.exam_attempts(status text, deadline_at timestamptz);
    create schema vault;
    create table vault.decrypted_secrets(name text, decrypted_secret text);
    create schema cron;
    create table cron.job(jobid bigint, jobname text);
    create table cron.job_run_details(jobid bigint, end_time timestamptz);
    insert into cron.job values (1, 'vfuture-exam-sweep'), (2, 'unrelated');
    insert into cron.job_run_details values (1, now()-interval '8 days'), (2, now()-interval '8 days');
    create schema net;
    create table net._http_response(id bigint, status_code integer);
    create table net.calls(id bigserial, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
    returns bigint language sql as $$
      insert into net.calls(url, headers, body, timeout_milliseconds) values ($1,$2,$3,$4) returning id;
    $$;
  `);
  const sql = readFileSync(new URL('../sql/exam-sweep-scheduler.sql', import.meta.url), 'utf8').replace('__ACADEMY_EXAM_SWEEP_URL__', 'https://academy.example.test/api/v1/internal/exams/sweep');
  await db.exec(sql);
  await db.exec(sql); // Idempotent operational setup.
  const enqueue = async (force = false) => (await db.query('select vfuture_ops.enqueue_exam_sweep($1) as id', [force])).rows[0].id;

  assert.equal(await enqueue(), null);
  assert.equal((await db.query('select count(*)::integer as n from net.calls')).rows[0].n, 0);
  assert.deepEqual((await db.query('select jobid from cron.job_run_details')).rows, [{ jobid: 2 }]);
  await db.exec(`insert into public.exam_attempts values
    ('in_progress', now()+interval '1 minute'), ('in_progress', null),
    ('in_progress', now()-interval '10 seconds'), ('graded', now()-interval '1 hour');`);
  assert.equal(await enqueue(), null, 'future/untimed/completed attempts and the grace window do not call the app');
  await db.exec("insert into public.exam_attempts values ('in_progress', now()-interval '1 minute')");
  await assert.rejects(() => enqueue(), /credential is not configured/);
  await db.exec("insert into vault.decrypted_secrets values ('vfuture_exam_sweep_cron_secret', 'fixture-only')");

  const request = await enqueue();
  assert.equal(typeof request, 'number');
  assert.equal(await enqueue(), null, 'do not overlap an in-flight HTTP request');
  const call = (await db.query('select * from net.calls')).rows[0];
  assert.equal(call.url, 'https://academy.example.test/api/v1/internal/exams/sweep');
  assert.equal(call.headers.Authorization, 'Bearer fixture-only');
  assert.equal(call.timeout_milliseconds, 120000);
  assert.deepEqual(call.body, {});
  assert(!sql.includes('fixture-only'), 'no credentials in the scheduled SQL');
  await db.query('insert into net._http_response values ($1, 500)', [request]);
  assert.equal(typeof await enqueue(), 'number', 'an unsuccessful request can retry');
  await db.exec('delete from vfuture_ops.exam_sweep_requests; delete from public.exam_attempts');
  assert.equal(typeof await enqueue(true), 'number', 'explicit setup probe can verify an idle endpoint');

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query('select vfuture_ops.enqueue_exam_sweep(true)'), /permission denied/);
    await db.exec('reset role');
  }
  console.log('PASS: idle/grace filtering, authorization, async overlap/retry, retention, role isolation and setup probe');
} finally { await db.close(); }

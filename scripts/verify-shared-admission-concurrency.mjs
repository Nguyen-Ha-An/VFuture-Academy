#!/usr/bin/env node
// Isolated native PostgreSQL: no TCP listener, ambient database URL, or hosted state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioFixtureClient, discoverStudioPostgresBinaries } from './lib/studio-postgres-fixture.mjs';
import { fixture, startSql } from './verify-shared-admission.mjs';

const runtime = discoverStudioPostgresBinaries();
const root = realpathSync(mkdtempSync('/tmp/admission-pg.'));
const data = join(root, 'data');
const socket = join(root, 'socket');
mkdirSync(socket, { mode: 0o700 });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:PG|SUPABASE_|NEXT_PUBLIC_SUPABASE_|DATABASE_URL$)/.test(key)));
const invoke = (name, args) => execFileSync(join(runtime.bin, name), args, { env, stdio: 'pipe' });
const clients = [];
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  if (existsSync(join(data, 'postmaster.pid'))) invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  rmSync(root, { recursive: true, force: true });
  if (runtime.temporaryRuntime) rmSync(runtime.temporaryRuntime, { recursive: true, force: true });
  cleaned = true;
}
const exit = () => { try { cleanup(); } catch { console.error('Admission fixture shutdown failed; owned files retained.'); process.exitCode = 1; } };
process.once('exit', exit);
const interrupt = () => { exit(); process.exit(130); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  invoke('initdb', ['-D', data, '-U', 'admission_test', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
  invoke('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${socket} -p 55438 -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`, '-w', 'start']);
  for (let i = 0; i < 3; i++) {
    const client = createStudioFixtureClient({ host: socket, port: 55438, user: 'admission_test', database: 'postgres', connectionTimeoutMillis: 5000, statement_timeout: 8000 });
    await client.connect(); clients.push(client);
  }
  const [owner, contender, observer] = clients;
  assert.equal((await observer.query('show listen_addresses')).rows[0].listen_addresses, '');
  await owner.query(fixture);
  await owner.query(readFileSync(new URL('../supabase/migrations/20261025135531_shared_public_and_exam_admission.sql', import.meta.url), 'utf8'));
  await owner.query('update public.academy_runtime_limits set max_active_exam_attempts=25 where singleton');
  const args = () => [randomUUID(), randomUUID(), '00000000-0000-4000-8000-000000000001'];
  for (let i = 0; i < 24; i++) await owner.query(startSql, args());
  const pid = (await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
  const waitForLock = async () => {
    for (let i = 0; i < 200; i++) {
      const { rows } = await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [pid]);
      if (rows[0]?.wait_event_type === 'Lock') return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Competing transaction never waited on the admission lock');
  };
  // A genuine overlap: contender is confirmed waiting while the 25th seat is uncommitted.
  await owner.query('begin');
  const last = (await owner.query(startSql, args())).rows[0];
  const rejected = contender.query(startSql, args()).then(() => ({ code: 'unexpected_success' }), (error) => error);
  await waitForLock();
  await owner.query('commit');
  assert.equal((await rejected).code, 'P3002');
  assert.equal((await observer.query("select count(*)::int n from public.exam_attempts where status='in_progress'")).rows[0].n, 25);
  await owner.query('delete from public.exam_attempts where id=$1', [last.id]);
  // A rolled-back reservation consumes no place, and waiting admission can proceed.
  await owner.query('begin');
  await owner.query(startSql, args());
  const admitted = contender.query(startSql, args());
  await waitForLock();
  await owner.query('rollback');
  assert.equal((await admitted).rows[0].status, 'in_progress');
  // Shared limiter also holds the same lock through the full calling transaction.
  const hash = (v) => createHash('sha256').update(v).digest('hex');
  const claim = 'select public.public_rate_limit($1,$2) as result';
  const identity = [hash('one-session'), hash('school')];
  for (let i = 0; i < 59; i++) await owner.query(claim, identity);
  await owner.query('begin');
  assert.equal((await owner.query(claim, identity)).rows[0].result.allowed, true);
  const finalClaim = contender.query(claim, identity);
  await waitForLock();
  await owner.query('commit');
  assert.equal((await finalClaim).rows[0].result.allowed, false);
  console.log('Native admission concurrency passed: observed row-lock wait, 25th commit rejects 26th, rollback frees seat, shared-session 60th/61st serialize. TCP disabled.');
} finally {
  for (const client of clients) await client.end().catch(() => {});
  cleanup();
  process.removeListener('exit', exit);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}

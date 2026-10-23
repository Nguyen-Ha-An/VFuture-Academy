import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { productionProjectRef } from './check-production-target';
import { loadEnvironment } from './load-env';

export const EXAM_SWEEP_JOB = 'vfuture-exam-sweep';
export const EXAM_SWEEP_SCHEDULE = '2-59/5 * * * *';
const command = 'select vfuture_ops.enqueue_exam_sweep();';
const secretName = 'vfuture_exam_sweep_cron_secret';
interface Database {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function sweepResponseSucceeded(response: Record<string, unknown>) {
  if (response.status_code !== 200 || response.timed_out || response.error_msg) return false;
  try {
    const result = JSON.parse(String(response.content));
    return Array.isArray(result.data) && result.data.every((entry: unknown) =>
      entry !== null && typeof entry === 'object' && !('error' in entry)
      && 'attemptId' in entry && typeof entry.attemptId === 'string' && entry.attemptId.length > 0
      && 'status' in entry && ['graded', 'pending_manual', 'expired'].includes(String(entry.status)));
  } catch { return false; }
}

/** Render only a validated origin into the operator-owned scheduler SQL. */
export function examSweepSql(appUrl = process.env.NEXT_PUBLIC_APP_URL): string {
  const url = new URL(appUrl ?? '');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an Academy HTTP(S) origin.');
  }
  const endpoint = new URL('/api/v1/internal/exams/sweep', url).toString();
  return readFileSync(new URL('./sql/exam-sweep-scheduler.sql', import.meta.url), 'utf8')
    .replace('__ACADEMY_EXAM_SWEEP_URL__', endpoint);
}

/** Install paused, verify a real pg_net response, then activate. Safe to retry. */
export async function installExamSweep(db: Database, secret: string, sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!secret?.trim()) throw new Error('CRON_SECRET is required.');
  const schedulerSql = examSweepSql();
  let jobId: unknown;
  await db.query('BEGIN');
  try {
    await db.query('select pg_advisory_xact_lock(732719, 2)');
    await db.query('create extension if not exists pg_cron');
    await db.query('create extension if not exists pg_net');
    await db.query('create extension if not exists supabase_vault');
    const stored = await db.query('select id, decrypted_secret = $2 as matches from vault.decrypted_secrets where name = $1', [secretName, secret]);
    if (!stored.rows.length) {
      await db.query('select vault.create_secret($1, $2, $3)', [secret, secretName, 'Production exam cleanup authorization']);
    } else if (stored.rows.length !== 1 || stored.rows[0].matches !== true) {
      throw new Error('Existing sweep Vault credential differs. Rotate it explicitly before rerunning setup.');
    }
    await db.query(schedulerSql);
    const existing = await db.query('select jobid, schedule, command from cron.job where jobname = $1', [EXAM_SWEEP_JOB]);
    if (existing.rows.length) {
      if (existing.rows.length !== 1 || existing.rows[0].command !== command || existing.rows[0].schedule !== EXAM_SWEEP_SCHEDULE) {
        throw new Error('An existing sweep job has different settings; review it before replacing it.');
      }
      jobId = existing.rows[0].jobid;
    } else {
      jobId = (await db.query('select cron.schedule($1, $2, $3) as jobid', [EXAM_SWEEP_JOB, EXAM_SWEEP_SCHEDULE, command])).rows[0].jobid;
      await db.query('select cron.alter_job($1, active := false)', [jobId]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  // An HTTP request starts only after its transaction commits. A pg_cron
  // "succeeded" entry alone proves enqueueing, not successful cleanup.
  const enqueued = await db.query('select vfuture_ops.enqueue_exam_sweep(true) as request_id');
  const requestId = enqueued.rows[0].request_id;
  if (requestId === null) throw new Error('Another sweep is in flight. Retry setup after it finishes.');
  for (let attempt = 0; attempt < 130; attempt += 1) {
    const { rows } = await db.query('select status_code, timed_out, error_msg, content from net._http_response where id = $1', [requestId]);
    if (rows.length) {
      if (!sweepResponseSucceeded(rows[0])) throw new Error('Sweep HTTP/application verification failed; the new cron job remains paused.');
      await db.query('select cron.alter_job($1, active := true)', [jobId]);
      return { jobId, requestId, schedule: EXAM_SWEEP_SCHEDULE, verified: true };
    }
    await sleep(1000);
  }
  throw new Error('Sweep response timed out; the new cron job remains paused.');
}

async function main() {
  loadEnvironment();
  const mode = process.argv[2] ?? 'status';
  if (!['status', 'apply'].includes(mode)) throw new Error('Use status (read-only) or apply.');
  productionProjectRef(process.env);
  const db = new Client({ connectionString: process.env.SUPABASE_PRODUCTION_DB_URL, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
  try {
    await db.connect();
    if (mode === 'apply') {
      console.log(JSON.stringify(await installExamSweep(db, process.env.CRON_SECRET ?? '')));
    } else {
      await db.query('BEGIN READ ONLY');
      const extensions = (await db.query("select name, installed_version from pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault')")).rows;
      const installed = extensions.length === 3 && extensions.every(row => row.installed_version);
      const jobs = installed ? (await db.query('select jobid, schedule, active from cron.job where jobname = $1', [EXAM_SWEEP_JOB])).rows : [];
      const ledger = (await db.query("select to_regclass('vfuture_ops.exam_sweep_requests') as name")).rows[0].name;
      const responses = installed && ledger ? (await db.query(`select r.requested_at, h.status_code, h.timed_out, h.error_msg is not null as network_error, h.content
        from vfuture_ops.exam_sweep_requests r left join net._http_response h on h.id = r.request_id
        order by r.requested_at desc limit 5`)).rows.map(({ content, ...row }) => ({
          ...row, application_ok: content == null ? null : sweepResponseSucceeded({ ...row, content, error_msg: row.network_error }),
        })) : [];
      await db.query('ROLLBACK');
      console.log(JSON.stringify({ extensions, jobs, responses }));
    }
  } finally { await db.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Database errors can include SQL parameter values. Never print the raw error.
    console.error('Exam scheduler setup/inspection failed. No automatic GitHub cutover was performed; check the target, Vault credential, and HTTP response in Supabase.');
    process.exitCode = 1;
  });
}

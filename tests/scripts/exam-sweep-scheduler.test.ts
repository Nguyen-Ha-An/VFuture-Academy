import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAM_SWEEP_SCHEDULE, examSweepSql, installExamSweep, sweepResponseSucceeded } from '../../scripts/configure-exam-sweep';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://academy.example.test'));
afterEach(() => vi.unstubAllEnvs());

const ok = { status_code: 200, timed_out: false, error_msg: null, content: '{"data":[]}' };
function database(response = ok, existing?: Record<string, unknown>) {
  return { query: vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('select id, decrypted_secret')) return { rows: [] };
    if (sql.startsWith('select jobid, schedule')) return { rows: existing ? [existing] : [] };
    if (sql.startsWith('select cron.schedule')) return { rows: [{ jobid: 7 }] };
    if (sql.startsWith('select vfuture_ops.enqueue')) return { rows: [{ request_id: 9 }] };
    if (sql.startsWith('select status_code')) return { rows: [response] };
    return { rows: [] };
  }) };
}

describe('Supabase exam scheduler cutover', () => {
  it('creates a paused job, verifies HTTP success, and only then activates it', async () => {
    const db = database();
    expect(await installExamSweep(db, 'fixture-secret')).toEqual({ jobId: 7, requestId: 9, schedule: EXAM_SWEEP_SCHEDULE, verified: true });
    const calls = db.query.mock.calls;
    const sql = calls.map(([text]) => text);
    expect(sql.indexOf('select cron.alter_job($1, active := false)')).toBeLessThan(sql.indexOf('COMMIT'));
    expect(sql.indexOf('COMMIT')).toBeLessThan(sql.indexOf('select vfuture_ops.enqueue_exam_sweep(true) as request_id'));
    expect(sql.at(-1)).toBe('select cron.alter_job($1, active := true)');
    expect(sql.join('\n')).not.toContain('fixture-secret');
    expect(calls.find(([text]) => text.startsWith('select vault.create_secret'))?.[1]).toContain('fixture-secret');
  });
  it('does not enable the schedule on HTTP failure or application errors', async () => {
    for (const response of [{ ...ok, status_code: 401 }, { ...ok, content: '{"data":[{"error":{"code":"FAILED"}}]}' }]) {
      const db = database(response);
      await expect(installExamSweep(db, 'fixture-secret')).rejects.toThrow('verification failed');
      expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain('select cron.alter_job($1, active := true)');
    }
  });
  it('rejects a missing credential before touching the database', async () => {
    const db = database();
    await expect(installExamSweep(db, '')).rejects.toThrow('CRON_SECRET');
    expect(db.query).not.toHaveBeenCalled();
  });
  it('does not replace an existing job with different settings', async () => {
    const db = database(ok, { jobid: 3, schedule: '* * * * *', command: 'select other_job()' });
    await expect(installExamSweep(db, 'fixture-secret')).rejects.toThrow('different settings');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('does not pause or duplicate an already configured job on rerun', async () => {
    const db = database(ok, { jobid: 3, schedule: EXAM_SWEEP_SCHEDULE, command: 'select vfuture_ops.enqueue_exam_sweep();' });
    expect(await installExamSweep(db, 'fixture-secret')).toMatchObject({ jobId: 3, verified: true });
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('select cron.schedule'))).toBe(false);
    expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain('select cron.alter_job($1, active := false)');
  });
  it('validates the API envelope, not just the HTTP status', () => {
    expect(sweepResponseSucceeded(ok)).toBe(true);
    expect(sweepResponseSucceeded({ ...ok, content: '{"data":[{"attemptId":"fixture","status":"graded"}]}' })).toBe(true);
    for (const change of [{ content: '<html>Login</html>' }, { content: '{}' }, { content: '{"data":[null]}' }, { content: '{"data":[{}]}' }, { timed_out: true }, { error_msg: 'network failure' }]) {
      expect(sweepResponseSucceeded({ ...ok, ...change })).toBe(false);
    }
  });

  it('does not rotate a different existing Vault credential', async () => {
    const db = database();
    const query = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values) => sql.startsWith('select id, decrypted_secret')
      ? { rows: [{ id: 'existing-secret', matches: false }] } : query(sql, values));
    await expect(installExamSweep(db, 'fixture-secret')).rejects.toThrow('Rotate it explicitly');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('bounds response polling and leaves a new job paused on timeout', async () => {
    const db = database();
    const query = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values) => sql.startsWith('select status_code') ? { rows: [] } : query(sql, values));
    const sleep = vi.fn(async () => undefined);
    await expect(installExamSweep(db, 'fixture-secret', sleep)).rejects.toThrow('timed out');
    expect(sleep).toHaveBeenCalledTimes(130);
    expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain('select cron.alter_job($1, active := true)');
  });
});

it('binds the scheduler to the independent Academy origin and rejects unsafe endpoints', () => {
  expect(examSweepSql('https://academy.example.test')).toContain("url := 'https://academy.example.test/api/v1/internal/exams/sweep'");
  for (const value of ['https://user:password@academy.example', 'https://academy.example/path', 'http://academy.example', 'https://academy.example?target=other']) {
    expect(() => examSweepSql(value)).toThrow();
  }
});

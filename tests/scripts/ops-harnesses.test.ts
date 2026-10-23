import { describe, expect, it, vi } from 'vitest';

import {
  parseRestoredDatabaseUrl,
  verifyBackupRowCounts,
} from '../../scripts/verify-backup';
import {
  readLoadTestConfig,
  runAnswerLoadTest,
} from '../../scripts/load-test-answers';


describe('backup verification harness', () => {
  it('never falls back to an ambient database URL', () => {
    const readFile = vi.fn(() => 'postgresql://operator@example.test/restored\n');

    expect(() => parseRestoredDatabaseUrl([], readFile)).toThrow('explicit --url-file');
    expect(() => parseRestoredDatabaseUrl(['--url', 'postgresql://operator@example.test/restored'], readFile))
      .toThrow('explicit --url-file');
    expect(readFile).not.toHaveBeenCalled();
    expect(parseRestoredDatabaseUrl(['--url-file', 'restored-url.txt'], readFile))
      .toBe('postgresql://operator@example.test/restored');
    expect(readFile).toHaveBeenCalledWith('restored-url.txt', 'utf8');
    expect(() => parseRestoredDatabaseUrl(
      ['--url-file', 'restored-url.txt'],
      () => 'https://example.test',
    )).toThrow('Postgres');
  });

  it('counts every public table inside a read-only transaction', async () => {
    const statements: string[] = [];
    const client = {
      async query(text: string) {
        statements.push(text);
        if (text.includes('information_schema.tables')) {
          return { rows: [{ table_name: 'audit_log' }, { table_name: 'profiles' }] };
        }
        if (text.includes('"audit_log"')) return { rows: [{ count: '12' }] };
        if (text.includes('"profiles"')) return { rows: [{ count: '34' }] };
        return { rows: [] };
      },
    };

    await expect(verifyBackupRowCounts(client)).resolves.toEqual({ audit_log: 12, profiles: 34 });
    expect(statements[0]).toBe('BEGIN READ ONLY');
    expect(statements).toContain("SET LOCAL statement_timeout = '30s'");
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.every((statement) => !/insert|update|delete|drop|alter/i.test(statement))).toBe(true);
  });
});

function seeds(count = 200) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
    attemptId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    cookie: `session=learner-${index}`,
    answers: { 'question-1': `answer-${index}` },
  }));
}

describe('exam answer load-test harness', () => {
  it('refuses to load seed data unless the explicit safety switch is enabled', () => {
    const readFile = vi.fn(() => JSON.stringify(seeds()));

    expect(() => readLoadTestConfig({
      BASE_URL: 'https://academy.example',
      LOAD_TEST_SEED_FILE: 'seeds.json',
    }, readFile)).toThrow('LOAD_TEST_ALLOW=1');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('requires 200 unique seeded learner attempts', () => {
    const environment = {
      LOAD_TEST_ALLOW: '1',
      BASE_URL: 'https://academy.example',
      LOAD_TEST_SEED_FILE: 'seeds.json',
    };

    expect(() => readLoadTestConfig(environment, () => JSON.stringify(seeds(199))))
      .toThrow('at least 200');
    const duplicates = seeds();
    duplicates[199] = duplicates[0];
    expect(() => readLoadTestConfig(environment, () => JSON.stringify(duplicates)))
      .toThrow('unique');
    const duplicateUsers = seeds();
    duplicateUsers[199].userId = duplicateUsers[0].userId;
    expect(() => readLoadTestConfig(environment, () => JSON.stringify(duplicateUsers)))
      .toThrow('Auth user IDs');
  });

  it('rechecks the safety switch immediately before issuing requests', async () => {
    const config = readLoadTestConfig({
      LOAD_TEST_ALLOW: '1',
      BASE_URL: 'https://academy.example',
      LOAD_TEST_SEED_FILE: 'seeds.json',
    }, () => JSON.stringify(seeds()));
    const fetcher = vi.fn();

    await expect(runAnswerLoadTest(config, fetcher, {}))
      .rejects.toThrow('LOAD_TEST_ALLOW=1');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts one answer payload for each of 200 concurrent virtual learners', async () => {
    const config = readLoadTestConfig({
      LOAD_TEST_ALLOW: '1',
      BASE_URL: 'https://academy.example',
      LOAD_TEST_SEED_FILE: 'seeds.json',
    }, () => JSON.stringify(seeds()));
    let active = 0;
    let maximumConcurrency = 0;
    const fetcher = vi.fn(async () => {
      active += 1;
      maximumConcurrency = Math.max(maximumConcurrency, active);
      await Promise.resolve();
      active -= 1;
      return new Response('{}', { status: 200 });
    });

    const summary = await runAnswerLoadTest(config, fetcher, { LOAD_TEST_ALLOW: '1' });

    expect(fetcher).toHaveBeenCalledTimes(200);
    expect(maximumConcurrency).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(1,
      'https://academy.example/api/v1/exams/attempts/00000000-0000-4000-8000-000000000000/answers',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        headers: { 'content-type': 'application/json', cookie: 'session=learner-0' },
        body: JSON.stringify({ answers: { 'question-1': 'answer-0' } }),
      }),
    );
    expect(summary).toMatchObject({ total: 200, succeeded: 200, failed: 0, statuses: { 200: 200 } });
  });

  it('bounds stalled requests and reports timeouts separately', async () => {
    const config = readLoadTestConfig({
      LOAD_TEST_ALLOW: '1',
      LOAD_TEST_TIMEOUT_MS: '100',
      BASE_URL: 'https://academy.example',
      LOAD_TEST_SEED_FILE: 'seeds.json',
    }, () => JSON.stringify(seeds()));
    const fetcher = vi.fn((_input: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const completion = setTimeout(() => resolve(new Response('{}', { status: 200 })), 250);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(completion);
        reject(new DOMException('Timed out', 'AbortError'));
      });
    }));

    const summary = await runAnswerLoadTest(config, fetcher, { LOAD_TEST_ALLOW: '1' });

    expect(config.timeoutMs).toBe(100);
    expect(summary).toMatchObject({ total: 200, succeeded: 0, failed: 200, statuses: { timeout: 200 } });
  });
});

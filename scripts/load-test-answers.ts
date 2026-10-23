import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const VIRTUAL_LEARNERS = 200;

const seedSchema = z.object({
  userId: z.uuid(),
  attemptId: z.uuid(),
  cookie: z.string().min(1).max(8192),
  answers: z.record(z.string().min(1).max(194), z.unknown()),
}).strict();

const seedsSchema = z.array(seedSchema).min(VIRTUAL_LEARNERS);

export type AnswerLoadTestSeed = z.output<typeof seedSchema>;
export type AnswerLoadTestConfig = {
  baseUrl: string;
  seeds: AnswerLoadTestSeed[];
  timeoutMs: number;
  requestHeaders?: Record<string, string>;
};
type ReadTextFile = (path: string, encoding: 'utf8') => string;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

function parseBaseUrl(value: string | undefined) {
  if (!value) throw new Error('BASE_URL is required');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BASE_URL must be a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('BASE_URL must use HTTPS unless it is localhost');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BASE_URL must be an origin without a path, query, or fragment');
  }
  return url.origin;
}

export function readLoadTestConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
  readTextFile: ReadTextFile = readFileSync,
): AnswerLoadTestConfig {
  if (source.LOAD_TEST_ALLOW !== '1') {
    throw new Error('Refusing to run: set LOAD_TEST_ALLOW=1 only for an approved target');
  }
  const baseUrl = parseBaseUrl(source.BASE_URL);
  const timeoutMs = z.coerce.number().int().min(100).max(120_000).default(10_000)
    .parse(source.LOAD_TEST_TIMEOUT_MS);
  if (!source.LOAD_TEST_SEED_FILE) throw new Error('LOAD_TEST_SEED_FILE is required');
  let raw: unknown;
  try {
    raw = JSON.parse(readTextFile(source.LOAD_TEST_SEED_FILE, 'utf8'));
  } catch (error) {
    throw new Error('LOAD_TEST_SEED_FILE must contain valid JSON', { cause: error });
  }
  const parsed = seedsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`LOAD_TEST_SEED_FILE must contain at least ${VIRTUAL_LEARNERS} valid learner seeds`);
  const selected = parsed.data.slice(0, VIRTUAL_LEARNERS);
  if (new Set(selected.map(({ attemptId }) => attemptId)).size !== VIRTUAL_LEARNERS) {
    throw new Error('The first 200 seeded attempt IDs must be unique');
  }
  if (new Set(selected.map(({ userId }) => userId)).size !== VIRTUAL_LEARNERS) {
    throw new Error('The first 200 seeded Auth user IDs must be unique');
  }
  return { baseUrl, seeds: selected, timeoutMs };
}

function percentile(values: number[], proportion: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil(sorted.length * proportion) - 1] * 100) / 100;
}

/** Starts all 200 requests together; callers own target approval and seed creation. */
export async function runAnswerLoadTest(
  config: AnswerLoadTestConfig,
  fetcher: Fetcher = fetch,
  source: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (source.LOAD_TEST_ALLOW !== '1') {
    throw new Error('Refusing to run: set LOAD_TEST_ALLOW=1 only for an approved target');
  }
  const suiteStartedAt = performance.now();
  const results = await Promise.all(config.seeds.map(async (seed) => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetcher(
        `${config.baseUrl}/api/v1/exams/attempts/${encodeURIComponent(seed.attemptId)}/answers`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: seed.cookie, ...config.requestHeaders },
          body: JSON.stringify({ answers: seed.answers }),
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      await response.arrayBuffer();
      return { status: String(response.status), ok: response.ok, durationMs: performance.now() - startedAt };
    } catch {
      return {
        status: controller.signal.aborted ? 'timeout' : 'network_error',
        ok: false,
        durationMs: performance.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }));
  const statuses = results.reduce<Record<string, number>>((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    return summary;
  }, {});
  const durations = results.map(({ durationMs }) => durationMs);
  const succeeded = results.filter(({ ok }) => ok).length;
  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    statuses,
    durationMs: Math.round((performance.now() - suiteStartedAt) * 100) / 100,
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
  };
}

/* v8 ignore start -- intentionally never exercised without an approved host and private seed file. */
async function main() {
  const summary = await runAnswerLoadTest(readLoadTestConfig());
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('Answer load test refused or failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  });
}
/* v8 ignore stop */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { z } from 'zod';
import { migrationFiles } from './apply-migrations';
import { loadEnvironment } from './load-env';
import { checkEnvironment, type ReadinessProbes } from './lib/environment-readiness';

const bucketsSchema = z.array(z.object({ id: z.string(), public: z.boolean() }));
const authSchema = z.object({ external: z.object({ email: z.boolean().optional(), google: z.boolean().optional() }).optional() });

async function readJson(url: string, key: string, bearer: boolean) {
  const response = await fetch(url, {
    headers: { apikey: key, ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Readiness request failed');
  return response.json() as Promise<unknown>;
}

/** All SQL runs in a read-only transaction; no migration, seed, or storage writes. */
export function readinessProbes(cwd = process.cwd()): ReadinessProbes {
  return {
    async database(url) {
      const directory = resolve(cwd, 'supabase/migrations');
      const files = migrationFiles(directory);
      const requiredTables = [...new Set(files.flatMap(filename => {
        const sql = readFileSync(resolve(directory, filename), 'utf8');
        return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map(match => match[1]);
      }))];
      const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 10_000, statement_timeout: 10_000 });
      try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        const tables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const present = new Set(tables.rows.map(row => row.table_name));
        const applied = present.has('schema_migrations')
          ? (await client.query<{ filename: string }>('SELECT filename FROM public.schema_migrations ORDER BY filename')).rows.map(row => row.filename)
          : [];
        await client.query('ROLLBACK');
        return {
          missingTables: requiredTables.filter(table => !present.has(table)),
          missingMigrations: files.filter(file => !applied.includes(file)),
          unexpectedMigrations: applied.filter(file => !files.includes(file)),
        };
      } finally { await client.end(); }
    },
    async storage(url, key) { return bucketsSchema.parse(await readJson(`${url}/storage/v1/bucket`, key, true)); },
    async auth(url, key) { return authSchema.parse(await readJson(`${url}/auth/v1/settings`, key, false)); },
  };
}

async function main() {
  loadEnvironment();
  const configurationOnly = process.argv.includes('--configuration-only');
  const report = await checkEnvironment(process.env, readinessProbes(), { configurationOnly });
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const check of report.checks) console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.detail}`);
    console.log(report.ok
      ? configurationOnly ? 'Configuration formats passed. Runtime was not probed.' : 'Runtime probes passed. Browser acceptance is still required.'
      : 'Runtime readiness failed. No data was changed.');
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('Environment check failed. Check configuration and probe availability; no credential values are logged.');
    process.exitCode = 1;
  });
}

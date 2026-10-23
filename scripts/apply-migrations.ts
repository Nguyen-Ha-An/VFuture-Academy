import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { readScriptEnvironment } from './env';
import { loadEnvironment } from './load-env';

export interface MigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<{ filename?: string }> }>;
}

export function migrationFiles(migrationsDir: string) {
  if (!existsSync(migrationsDir)) throw new Error(`Migration directory does not exist: ${migrationsDir}`);
  return readdirSync(migrationsDir).filter((filename) => filename.endsWith('.sql')).sort();
}

async function ensureLedger(client: MigrationClient) {
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query(`DO $$
      DECLARE role_name text;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.schema_migrations FROM %I', role_name);
          END IF;
        END LOOP;
      END $$`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function assertImmutableOrdering(files: string[], applied: Set<string>) {
  const unknownApplied = [...applied].filter((filename) => !files.includes(filename));
  if (unknownApplied.length > 0) {
    throw new Error(`Applied migration is missing from disk: ${unknownApplied.sort().join(', ')}`);
  }

  const latestApplied = [...applied].sort().at(-1);
  if (!latestApplied) return;
  for (const filename of files) {
    if (!applied.has(filename) && filename <= latestApplied) {
      throw new Error(`Migration filename ${filename} must sort after the latest applied migration ${latestApplied}`);
    }
  }
}

/** Apply each new migration in its own transaction and append it to the ledger. */
export async function applyMigrations(client: MigrationClient, migrationsDir: string) {
  const files = migrationFiles(migrationsDir);
  await ensureLedger(client);
  const result = await client.query('SELECT filename FROM public.schema_migrations ORDER BY filename');
  const applied = new Set(result.rows.map(({ filename }) => filename).filter((filename): filename is string => Boolean(filename)));
  assertImmutableOrdering(files, applied);

  const pending = files.filter((filename) => !applied.has(filename));
  for (const filename of pending) {
    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed`, { cause: error });
    }
  }
  return pending;
}

export function reportMigrationFailure(error: unknown, logger: Pick<Console, 'error'> = console) {
  logger.error('Migration application error:', error instanceof Error && error.cause ? error.cause : error);
  logger.error('Migration application failed. Check the database connection and migration files.');
}

/* v8 ignore start -- requires a real credentialed database; applyMigrations is covered with a mocked pg client. */
async function main() {
  loadEnvironment();
  const { SUPABASE_DB_URL } = readScriptEnvironment();
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  await client.connect();
  try {
    const applied = await applyMigrations(client, resolve(process.cwd(), 'supabase/migrations'));
    console.log(applied.length === 0 ? 'No pending migrations.' : `Applied migrations: ${applied.join(', ')}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    reportMigrationFailure(error);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */

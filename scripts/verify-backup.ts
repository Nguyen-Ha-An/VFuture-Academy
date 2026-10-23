import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

export interface RowCountClient {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

type ReadTextFile = (path: string, encoding: 'utf8') => string;

export function parseRestoredDatabaseUrl(
  args: readonly string[],
  readTextFile: ReadTextFile = readFileSync,
) {
  const inline = args.find((argument) => argument.startsWith('--url-file='));
  const index = args.indexOf('--url-file');
  const urlFile = inline?.slice('--url-file='.length) ?? (index >= 0 ? args[index + 1] : undefined);
  if (!urlFile) {
    throw new Error('Backup verification requires an explicit --url-file for the restored database');
  }
  const value = readTextFile(urlFile, 'utf8').trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('The restored database URL must be a valid Postgres connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The restored database URL must use the Postgres protocol');
  }
  return value;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Returns exact public-table counts from a restored database without mutating it. */
export async function verifyBackupRowCounts(client: RowCountClient) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const tables = await client.query(`SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);
    const counts: Record<string, number> = {};
    for (const row of tables.rows) {
      if (typeof row.table_name !== 'string') throw new Error('Restored database returned an invalid table name');
      const result = await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(row.table_name)}`);
      const count = Number(result.rows[0]?.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid row count for ${row.table_name}`);
      counts[row.table_name] = count;
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/* v8 ignore start -- operator supplies a credentialed restored-database URL. */
async function main() {
  const connectionString = parseRestoredDatabaseUrl(process.argv.slice(2));
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const counts = await verifyBackupRowCounts(client);
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), counts }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('Restored backup verification failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  });
}
/* v8 ignore stop */

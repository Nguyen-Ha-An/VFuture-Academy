import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock('pg', () => ({ Client: class { connect = client.connect; query = client.query; end = client.end; } }));
import { readinessProbes } from '../../scripts/check-environment';
import { migrationFiles } from '../../scripts/apply-migrations';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeEach(() => {
  vi.resetAllMocks();
  client.connect.mockResolvedValue(undefined);
  client.end.mockResolvedValue(undefined);
});
describe('readiness database probe', () => {
  it('checks all migration tables and ledger in a read-only transaction without altering data', async () => {
    const directory = resolve('supabase/migrations');
    const files = migrationFiles(directory);
    const tables = files.flatMap(file => [...readFileSync(resolve(directory, file), 'utf8').matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map(m => m[1]));
    client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('information_schema')
      ? [...tables, 'schema_migrations'].map(table_name => ({ table_name }))
      : sql.startsWith('SELECT filename') ? files.map(filename => ({ filename })) : [] }));
    expect(await readinessProbes().database('postgresql://unused')).toEqual({ missingTables: [], missingMigrations: [], unexpectedMigrations: [] });
    expect(client.query.mock.calls.map(call => call[0])).toEqual([
      'BEGIN READ ONLY', "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      'SELECT filename FROM public.schema_migrations ORDER BY filename', 'ROLLBACK',
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });
  it('closes a failed connection and reports an empty schema without creating its ledger', async () => {
    client.query.mockResolvedValue({ rows: [] });
    const result = await readinessProbes().database('postgresql://unused');
    expect(result.missingTables).toContain('profiles');
    expect(result.missingMigrations).toContain('0001_identity.sql');
    expect(client.query.mock.calls.some(call => String(call[0]).includes('CREATE'))).toBe(false);
    client.connect.mockRejectedValueOnce(new Error('connection failed'));
    await expect(readinessProbes().database('postgresql://unused')).rejects.toThrow('connection failed');
    expect(client.end).toHaveBeenCalledTimes(2);
  });
});

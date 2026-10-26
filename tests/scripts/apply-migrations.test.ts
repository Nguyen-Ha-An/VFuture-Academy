import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyMigrations, migrationFiles, type MigrationClient } from '../../scripts/apply-migrations';
import { loadEnvironment } from '../../scripts/load-env';

class MockClient implements MigrationClient {
  readonly queries: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(private readonly applied: string[] = [], private readonly failOn?: string) {}

  async query(text: string, values?: readonly unknown[]) {
    this.queries.push({ text, values });
    if (text === this.failOn) throw new Error('database rejected SQL');
    if (text.startsWith('SELECT filename')) return { rows: this.applied.map((filename) => ({ filename })) };
    return { rows: [] };
  }
}

function migrationDirectory(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'vfuture-migrations-'));
  for (const [filename, sql] of Object.entries(files)) writeFileSync(join(directory, filename), sql);
  return directory;
}

describe('applyMigrations', () => {
  it('applies only pending SQL files in lexical filename order and records each with a parameterized query', async () => {
    const client = new MockClient(['0001_identity.sql']);
    const migrationsDir = migrationDirectory({
      '0002_later.sql': 'select 2;',
      '0001_identity.sql': 'select 1;',
      'README.md': 'not a migration',
    });

    const applied = await applyMigrations(client, migrationsDir);

    expect(applied).toEqual(['0002_later.sql']);
    expect(client.queries.filter(({ text }) => text === 'BEGIN')).toHaveLength(2);
    expect(client.queries).toContainEqual({
      text: 'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
      values: ['0002_later.sql'],
    });
    expect(client.queries).toContainEqual({ text: 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY', values: undefined });
    expect(client.queries.some(({ text }) => /do \$\$[\s\S]*pg_roles[\s\S]*revoke all on table public\.schema_migrations/i.test(text))).toBe(true);
    expect(client.queries.findIndex(({ text }) => text === 'select 2;')).toBeGreaterThan(
      client.queries.findIndex(({ text }) => text.startsWith('SELECT filename')),
    );
  });

  it('allows an intentional gap in migration numbering', async () => {
    const client = new MockClient(['0007_ecosystem.sql']);
    const migrationsDir = migrationDirectory({
      '0007_ecosystem.sql': 'select 7;',
      '0010_analytics_views.sql': 'select 10;',
    });

    await expect(applyMigrations(client, migrationsDir)).resolves.toEqual(['0010_analytics_views.sql']);
    expect(client.queries).toContainEqual({ text: 'select 10;', values: undefined });
    expect(client.queries).toContainEqual({
      text: 'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
      values: ['0010_analytics_views.sql'],
    });
  });

  it('accepts the checked-in migration set in lexical order on a fresh ledger', async () => {
    const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
    const expected = [
      '0001_identity.sql',
      '0002_content.sql',
      '0003_studio_functions.sql',
      '0004_learning.sql',
      '0005_submission_functions.sql',
      '0006_question_bank.sql',
      '0007_ecosystem.sql',
      '0009_public_profiles.sql',
      '0010_analytics_views.sql',
      '0011_learning_progress_functions.sql',
      '0012_usage_lookups.sql',
      '0013_project_approval.sql',
      '0014_project_workflows.sql',
      '0015_project_scope_hardening.sql',
      '0016_completion_effects.sql',
      '0017_rate_limit.sql',
      '0018_enrollment_migration.sql',
      '0019_rate_limit_gc_window.sql',
      '0020_rate_limit_gc_index.sql',
      '0021_rate_limit_expiry.sql',
      '0022_fix_studio_replace_draft_conflict.sql',
      '0023_fix_completion_effect_conflict.sql',
      '0024_guard_studio_replace_draft.sql',
      '0025_atomic_exam_attempt_writes.sql',
      '0026_atomic_exam_release.sql',
      '0027_guard_assignment_lifecycle.sql',
      '0032_fix_pending_grading_latest_assignment.sql',
      '0033_fix_admin_search_clock.sql',
      '0034_studio_atomic_workspace.sql',
      '20260906065948_admin_authorization_foundation.sql',
      '20260906065949_admin_management.sql',
      '20260906065951_admin_content_review.sql',
      '20260906065957_notebook_foundation.sql',
      '20260907085959_cms_pgcrypto_schema.sql',
      '20260907090000_media_asset_purpose.sql',
      '20260907090001_media_authoring_guards.sql',
      '20260907091000_quiz_attempt_branch_history.sql',
      '20260907091001_studio_learning_reports.sql',
      '20260907091002_review_queue_permissions.sql',
      '20260907092000_exam_result_availability.sql',
      '20260908224000_studio_workflow_atomic_publish.sql',
      '20260926000000_studio_mcp_access_blocks.sql',
      '20260926090000_media_project_cover_purpose.sql',
      '20261007101233_security_active_catalog_and_hidden_quiz_results.sql',
      '20261007101246_resource_create_ownership_guard.sql',
      '20261023120729_preserve_shared_content_destinations.sql',
      '20261025135531_shared_public_and_exam_admission.sql',
      '20261025140618_academy_media_upload_reservations.sql',
      '20261026145220_restrict_internal_function_execution.sql',
    ];
    const files = migrationFiles(migrationsDir);
    const prefixes = files.map((filename) => filename.split('_')[0]);
    const client = new MockClient();

    expect(files).toEqual(expected);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    await expect(applyMigrations(client, migrationsDir)).resolves.toEqual(expected);
  });

  it('rejects a newly introduced migration that sorts before an applied ledger entry', async () => {
    const client = new MockClient(['0002_identity.sql']);
    const migrationsDir = migrationDirectory({
      '0001_backfill.sql': 'select 1;',
      '0002_identity.sql': 'select 2;',
    });

    await expect(applyMigrations(client, migrationsDir)).rejects.toThrow(
      'Migration filename 0001_backfill.sql must sort after the latest applied migration 0002_identity.sql',
    );
  });

  it('treats migration history as immutable when an applied file is removed from disk', async () => {
    const client = new MockClient(['0001_removed.sql']);
    const migrationsDir = migrationDirectory({ '0002_identity.sql': 'select 2;' });

    await expect(applyMigrations(client, migrationsDir)).rejects.toThrow(
      'Applied migration is missing from disk: 0001_removed.sql',
    );
  });

  it('rolls back the individual transaction when migration SQL fails', async () => {
    const client = new MockClient([], 'select broken;');
    const migrationsDir = migrationDirectory({ '0001_identity.sql': 'select broken;' });

    await expect(applyMigrations(client, migrationsDir)).rejects.toThrow('Migration 0001_identity.sql failed');
    expect(client.queries.filter(({ text }) => text === 'ROLLBACK')).toHaveLength(1);
  });

  it('accepts only SQL migration files and rejects a missing migration directory', () => {
    const migrationsDir = migrationDirectory({ '0002_identity.sql': 'select 2;', 'notes.txt': 'ignored' });

    expect(migrationFiles(migrationsDir)).toEqual(['0002_identity.sql']);
    expect(() => migrationFiles(join(migrationsDir, 'missing'))).toThrow('Migration directory does not exist');
  });

  it('loads Next-compatible environment files before scripts start', () => {
    expect(loadEnvironment(process.cwd()).combinedEnv).toBeDefined();
  });

  it('logs the underlying migration failure before the generic operator message', async () => {
    const migrationModule = await import('../../scripts/apply-migrations') as typeof import('../../scripts/apply-migrations') & {
      reportMigrationFailure?: (error: unknown, logger: Pick<Console, 'error'>) => void;
    };
    expect(migrationModule.reportMigrationFailure).toBeTypeOf('function');
    if (!migrationModule.reportMigrationFailure) return;
    const logger = { error: vi.fn() };
    const cause = new Error('connection refused');

    migrationModule.reportMigrationFailure(new Error('Migration failed', { cause }), logger);

    expect(logger.error).toHaveBeenNthCalledWith(1, 'Migration application error:', cause);
    expect(logger.error).toHaveBeenNthCalledWith(2, 'Migration application failed. Check the database connection and migration files.');
  });

  it('keeps the PostgreSQL 15 identity-schema uniqueness and RLS safeguards intact', () => {
    const schema = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0001_identity.sql'), 'utf8');

    expect(schema).toContain('id uuid primary key default gen_random_uuid()');
    expect(schema).toContain('unique nulls not distinct (user_id, role, branch_id)');
    expect(schema).not.toMatch(/primary key\s*\([^)]*coalesce/i);
    expect(schema).toContain('alter table public.profiles enable row level security');
    expect(schema).toContain('create trigger profiles_prevent_self_branch_change');
    expect(schema).not.toContain('create policy "public profiles"');
    expect(schema).toContain('security_invoker view exposing only (id, handle, display_name, avatar_url)');
    expect(schema.match(/set search_path = public, pg_temp/g)).toHaveLength(2);
  });
});

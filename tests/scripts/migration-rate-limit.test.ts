import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = join(process.cwd(), 'supabase', 'migrations');
const migrationName = readdirSync(migrationsDirectory)
  .find((name) => name.endsWith('_rate_limit.sql'));

if (!migrationName) throw new Error('Rate limit migration is missing');

const migrationPath = join(migrationsDirectory, migrationName);
const gcWindowMigrationPath = join(migrationsDirectory, '0019_rate_limit_gc_window.sql');
const gcIndexMigrationPath = join(migrationsDirectory, '0020_rate_limit_gc_index.sql');
const expiryMigrationPath = join(migrationsDirectory, '0021_rate_limit_expiry.sql');
const gcWindowMigration = () => (
  existsSync(gcWindowMigrationPath) ? readFileSync(gcWindowMigrationPath, 'utf8') : ''
);

describe('rate limit migration', () => {
  it('keeps the original rate-limit migration at its allocated number', () => {
    expect(migrationName).toBe('0017_rate_limit.sql');
  });

  it('uses an RLS-protected table without client policies', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create\s+table\s+public\.rate_limits/i);
    expect(sql).toMatch(/alter\s+table\s+public\.rate_limits\s+enable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/create\s+policy[\s\S]*?rate_limits/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+table\s+public\.rate_limits\s+from\s+public,\s*anon,\s*authenticated/i);
  });

  it('defines an atomic fixed-window function available only to the service role', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/function\s+public\.rate_limit\s*\(\s*key\s+text,\s*"?limit"?\s+int(?:eger)?,\s*window_seconds\s+int(?:eger)?\s*\)/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/insert\s+into\s+public\.rate_limits[\s\S]*?on\s+conflict[\s\S]*?do\s+update/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.rate_limit\s*\(\s*text,\s*integer,\s*integer\s*\)\s+to\s+service_role/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.rate_limit\s*\(\s*text,\s*integer,\s*integer\s*\)\s+from\s+public,\s*anon,\s*authenticated/i);
  });

  it('indexes expiry checks and initially exposes service-role-only garbage collection', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create\s+index\s+rate_limits_updated_at_idx\s+on\s+public\.rate_limits\s*\(\s*updated_at\s*\)/i);
    expect(sql).toMatch(/function\s+public\.rate_limit_gc\s*\(\s*\)[\s\S]*?security\s+definer/i);
    expect(sql).toMatch(/delete\s+from\s+public\.rate_limits[\s\S]*?updated_at\s*<\s*clock_timestamp\(\)\s*-\s*interval\s+'60 seconds'/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+to\s+service_role/i);
  });

  it('stores each bucket window and replaces garbage collection with per-window expiry', () => {
    const sql = gcWindowMigration();

    expect(existsSync(gcWindowMigrationPath)).toBe(true);
    expect(sql).toMatch(/alter\s+table\s+public\.rate_limits[\s\S]*?add\s+column\s+window_seconds\s+integer\s+not\s+null\s+default\s+3600/i);
    expect(sql).toMatch(/function\s+public\.rate_limit\s*\(\s*key\s+text,\s*"?limit"?\s+int(?:eger)?,\s*window_seconds\s+int(?:eger)?\s*\)/i);
    expect(sql).toMatch(/insert\s+into\s+public\.rate_limits[\s\S]*?window_seconds[\s\S]*?on\s+conflict[\s\S]*?window_seconds\s*=\s*\$3/i);
    expect(sql).toMatch(/delete\s+from\s+public\.rate_limits[\s\S]*?window_started_at\s*\+\s*make_interval\s*\(\s*secs\s*=>\s*window_seconds\s*\)\s*<=\s*clock_timestamp\(\)/i);
    expect(sql).not.toMatch(/interval\s+'60 seconds'/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+to\s+service_role/i);
  });

  it('adds the garbage-collection index in a new append-only migration', () => {
    expect(existsSync(gcIndexMigrationPath)).toBe(true);
    const sql = readFileSync(gcIndexMigrationPath, 'utf8');

    expect(sql).toMatch(
      /create\s+index\s+rate_limits_window_started_at_idx\s+on\s+public\.rate_limits\s*\(\s*window_started_at\s*\)/i,
    );
    expect(gcWindowMigration()).not.toMatch(/rate_limits_window_started_at_idx/i);
  });

  it('makes expiry indexable and drops the indexes no plan can use', () => {
    expect(existsSync(expiryMigrationPath)).toBe(true);
    const sql = readFileSync(expiryMigrationPath, 'utf8');

    expect(sql).toMatch(/alter\s+table\s+public\.rate_limits[\s\S]*?add\s+column\s+expires_at\s+timestamptz/i);
    expect(sql).toMatch(/update\s+public\.rate_limits[\s\S]*?set\s+expires_at\s*=\s*window_started_at\s*\+\s*make_interval\s*\(\s*secs\s*=>\s*window_seconds\s*\)/i);
    expect(sql).toMatch(/alter\s+column\s+expires_at\s+set\s+not\s+null/i);
    expect(sql).toMatch(/create\s+index\s+rate_limits_expires_at_idx\s+on\s+public\.rate_limits\s*\(\s*expires_at\s*\)/i);
    expect(sql).toMatch(/drop\s+index\s+if\s+exists\s+public\.rate_limits_updated_at_idx/i);
    expect(sql).toMatch(/drop\s+index\s+if\s+exists\s+public\.rate_limits_window_started_at_idx/i);

    // The claim function stays a single atomic upsert and now maintains expires_at itself.
    expect(sql).toMatch(/insert\s+into\s+public\.rate_limits[\s\S]*?expires_at[\s\S]*?on\s+conflict[\s\S]*?do\s+update/i);
    expect(sql).toMatch(/delete\s+from\s+public\.rate_limits\s*[\s\S]*?where\s+expires_at\s*<=\s*clock_timestamp\(\)/i);
    expect(sql).not.toMatch(/make_interval\s*\(\s*secs\s*=>\s*window_seconds\s*\)\s*<=\s*clock_timestamp\(\)/i);

    // Definer functions remain service-role only.
    for (const pattern of [
      /revoke\s+all\s+on\s+function\s+public\.rate_limit\s*\(\s*text,\s*integer,\s*integer\s*\)\s+from\s+public,\s*anon,\s*authenticated/i,
      /grant\s+execute\s+on\s+function\s+public\.rate_limit\s*\(\s*text,\s*integer,\s*integer\s*\)\s+to\s+service_role/i,
      /revoke\s+all\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+from\s+public,\s*anon,\s*authenticated/i,
      /grant\s+execute\s+on\s+function\s+public\.rate_limit_gc\s*\(\s*\)\s+to\s+service_role/i,
    ]) {
      expect(sql).toMatch(pattern);
    }

    // Earlier migrations stay immutable.
    expect(readFileSync(gcIndexMigrationPath, 'utf8')).not.toMatch(/expires_at/i);
    expect(gcWindowMigration()).not.toMatch(/expires_at/i);
  });

  it('documents a recurring database cron for rate-limit garbage collection', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('rate_limit_gc()');
    expect(readme).toMatch(/cron\.schedule[\s\S]*rate-limit-gc/i);
  });
});

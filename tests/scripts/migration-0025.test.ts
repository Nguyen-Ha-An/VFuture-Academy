import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0025_atomic_exam_attempt_writes.sql');

describe('migration 0025 atomic exam attempt writes', () => {
  it('admits answer saves only while the owned attempt is active under a row lock', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.exam_save_active_answers/i);
    expect(sql).toMatch(/from\s+public\.exam_attempts[\s\S]*for\s+update/i);
    expect(sql).toMatch(/locked_attempt\.user_id\s*<>\s*p_user_id[\s\S]*locked_attempt\.status\s*<>\s*'in_progress'/i);
    expect(sql).toMatch(/on\s+conflict\s+on\s+constraint\s+exam_answers_pkey\s+do\s+update/i);
  });

  it('writes result rows and the terminal attempt in one compare-and-set transaction', () => {
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
    const finalize = sql.match(/create\s+or\s+replace\s+function\s+public\.exam_finalize_attempt[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.exam_finalize_attempt/i);
    expect(sql).toMatch(/if\s+locked_attempt\.status\s*<>\s*'in_progress'[\s\S]*transitioned.*false/i);
    expect(sql).toMatch(/insert\s+into\s+public\.exam_answers[\s\S]*update\s+public\.exam_attempts/i);
    expect(sql).toMatch(/jsonb_object_agg\(answer\.question_id,\s*answer\.answer\)[\s\S]*accepted_answers\s+is\s+distinct\s+from\s+p_expected_answers/i);
    expect(sql).toMatch(/status\s*=\s*p_status[\s\S]*where\s+id\s*=\s*p_attempt_id[\s\S]*status\s*=\s*'in_progress'/i);
    expect(sql).toMatch(/transitioned.*true/i);
    expect(finalize).not.toMatch(/jsonb_(?:array|object)_length\([^)]*\)\s*>/i);
  });

  it('keeps both functions service-role only and search-path hardened', () => {
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

    expect(sql.match(/security\s+definer/gi)).toHaveLength(2);
    expect(sql.match(/set\s+search_path\s*=\s*public,\s*pg_temp/gi)).toHaveLength(2);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.exam_save_active_answers[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.exam_finalize_attempt[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
    expect(sql.match(/grant\s+execute[\s\S]*?to\s+service_role/gi)).toHaveLength(2);
  });
});

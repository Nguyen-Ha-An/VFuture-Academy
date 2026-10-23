import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0018_enrollment_migration.sql');
const schema = () => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

describe('0018_enrollment_migration.sql', () => {
  it('moves progress and enrollment together in a hardened per-learner function', () => {
    const sql = schema();

    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_migrate_enrollment\s*\(/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*public,\s*pg_temp/i);
    expect(sql).toMatch(/update\s+public\.lesson_progress[\s\S]*course_version_id\s*=\s*p_to_version/i);
    expect(sql).toMatch(/update\s+public\.enrollments[\s\S]*course_version_id\s*=\s*p_to_version/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.learner_migrate_enrollment[\s\S]*from\s+anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.learner_migrate_enrollment[\s\S]*to\s+service_role/i);
  });

  it('checks every old progress item against the target outline before either update', () => {
    const sql = schema();
    const eligibility = sql.search(/ITEM_NOT_IN_LATEST_VERSION/i);
    const progressUpdate = sql.search(/update\s+public\.lesson_progress/i);
    const enrollmentUpdate = sql.search(/update\s+public\.enrollments/i);

    expect(sql).toMatch(/course_version_outline/i);
    expect(sql).toMatch(/jsonb_array_elements/i);
    expect(eligibility).toBeGreaterThan(-1);
    expect(progressUpdate).toBeGreaterThan(eligibility);
    expect(enrollmentUpdate).toBeGreaterThan(progressUpdate);
    expect(sql).toMatch(/return\s+query\s+select\s+'skipped'/i);
    expect(sql).toMatch(/return\s+query\s+select\s+'migrated'/i);
  });
});

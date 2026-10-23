import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0005_submission_functions.sql');
const schema = () => existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('0005_submission_functions.sql', () => {
  it('atomically creates a submission and all attached file rows', () => {
    const sql = schema();

    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.submit_assignment\s*\(/i);
    expect(sql).toMatch(/insert\s+into\s+public\.assignment_submissions/i);
    expect(sql).toMatch(/insert\s+into\s+public\.submission_files/i);
    expect(sql).toMatch(/jsonb_to_recordset\s*\(/i);
  });

  it('atomically upserts a grade and updates its submission status', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.grade_assignment_submission\s*\(/i);
    expect(sql).toMatch(/insert\s+into\s+public\.grades[\s\S]*?on\s+conflict\s*\(submission_id\)\s+do\s+update/i);
    expect(sql).toMatch(/update\s+public\.assignment_submissions[\s\S]*?set\s+status/i);
    expect(sql).toMatch(/insert\s+into\s+public\.audit_log/i);
  });

  it('leaves progress recomputation to the wired application service', () => {
    const sql = schema();

    expect(sql).not.toMatch(/progress_recompute_outbox/i);
  });

  it('defines a shared atomic learner upload rate limiter', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+table\s+public\.learner_upload_rate_limits/i);
    expect(sql).toMatch(/alter\s+table\s+public\.learner_upload_rate_limits\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.claim_learner_upload\s*\(/i);
    expect(sql).toMatch(/on\s+conflict\s*\(user_id\)\s+do\s+update/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.claim_learner_upload[\s\S]*?to\s+service_role/i);
  });

  it('defines an atomic per-assignment submission limiter and a database attempt ceiling', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+table\s+public\.assignment_submission_rate_limits/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.claim_assignment_submission\s*\(/i);
    expect(sql).toMatch(/ATTEMPT_LIMIT/i);
    expect(sql).toMatch(/count\s*\(\s*\*\s*\)[\s\S]*?assignment_submissions/i);
  });

  it('persists the pass threshold result separately from the authoritative decision', () => {
    const sql = schema();

    expect(sql).toMatch(/alter\s+table\s+public\.grades[\s\S]*?add\s+column\s+passed\s+boolean/i);
    expect(sql).toMatch(/p_passed\s+boolean/i);
    expect(sql).toMatch(/insert\s+into\s+public\.grades[\s\S]*?passed/i);
  });

  it('prevents released approved grades from being overwritten inside the grading transaction', () => {
    const sql = schema();

    expect(sql).toMatch(/GRADE_RELEASED/i);
    expect(sql).toMatch(/submission_status[\s\S]*?approved[\s\S]*?released/i);
  });

  it('records assignment scope on learner-uploaded media for orphan expiry', () => {
    const sql = schema();

    expect(sql).toMatch(/alter\s+table\s+public\.media_assets[\s\S]*?add\s+column\s+item_id\s+text/i);
    expect(sql).toMatch(/create\s+index\s+media_assets_orphan_submissions/i);
  });

  it('keeps both mutation functions service-role only and fixes their search path', () => {
    const sql = schema();

    for (const name of ['submit_assignment', 'grade_assignment_submission']) {
      expect(sql).toMatch(new RegExp(
        `function\\s+public\\.${name}\\s*\\([\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*public,\\s*pg_temp`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?to\\s+service_role`, 'i'));
    }
  });
});

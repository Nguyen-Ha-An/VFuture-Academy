import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0010_analytics_views.sql');
const oldMigrationPath = join(process.cwd(), 'supabase', 'migrations', '0009_analytics_views.sql');
const schema = () => existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('0010_analytics_views.sql', () => {
  it('uses the unreserved migration number and hardens stored analytics events', () => {
    const sql = schema();
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(oldMigrationPath)).toBe(false);
    expect(sql).toMatch(/alter\s+table\s+public\.analytics_events[\s\S]*name\s+in\s*\(/i);
    expect(sql).toMatch(/octet_length\s*\(\s*props\s*::\s*text\s*\)\s*<=\s*4096/i);
  });

  it('bounds daily branch and course sources to 90 days without per-day correlated activity subqueries', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?view\s+public\.analytics_branch_daily/i);
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?view\s+public\.analytics_branch_course_daily/i);
    expect(sql.match(/current_date\s*-\s*89/gim)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/active_windows\s+as\s*\(/i);
    expect(sql).not.toMatch(/\(\s*select\s+count\s*\(\s*distinct\s+event\.user_id\s*\)[\s\S]*?where\s+profile\.branch_id\s*=\s*days\.branch_id/i);
    for (const table of ['analytics_events', 'enrollments', 'lesson_progress', 'quiz_attempts', 'exam_attempts', 'assignment_submissions']) {
      expect(sql, `missing ${table} analytics source`).toMatch(new RegExp(`public\\.${table}\\b`, 'i'));
    }
  });

  it('filters every quiz aggregate to submitted attempts and separates point-in-time grading workload', () => {
    const sql = schema();
    const dailyView = sql.split(/create\s+(?:or\s+replace\s+)?view\s+public\.analytics_branch_course_daily/i)[0];
    expect(dailyView).not.toMatch(/pending_grading_count/i);
    expect(sql.match(/quiz_attempts[\s\S]{0,500}?submitted_at\s+is\s+not\s+null/gim)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.analytics_pending_grading\s*\(\s*p_branch_id\s+text\s*\)/i);
    expect(sql).toMatch(/pending_grading_count[\s\S]*?pending_manual|pending_manual[\s\S]*?pending_grading_count/i);
  });

  it('defines bounded k-anonymous failed-question analytics without the unused course parameter', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.top_failed_questions\s*\(\s*p_branch_id\s+text\s*,\s*p_from\s+date\s*,\s*p_to\s+date\s*\)/i);
    expect(sql).not.toMatch(/p_course_id/i);
    expect(sql).toMatch(/attempt\.submitted_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/having[\s\S]*count\s*\(\s*\*\s*\)\s+filter[\s\S]*>=\s*5/i);
    expect(sql).toMatch(/security\s+definer\s+set\s+search_path\s*=\s*public,\s*pg_temp/i);
  });

  it('provides one service-role-only atomic admin mutation function with final-admin protection', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.admin_apply_mutation\s*\(/i);
    for (const operation of ['branch.create', 'branch.update', 'user.branch.assign', 'user.role.set']) {
      expect(sql).toContain(`'${operation}'`);
    }
    expect(sql).toMatch(/insert\s+into\s+public\.audit_log/i);
    expect(sql).toMatch(/role\s*=\s*'admin'[\s\S]*branch_id\s+is\s+null[\s\S]*cannot revoke final global admin/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.admin_apply_mutation[\s\S]*from\s+anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.admin_apply_mutation[\s\S]*to\s+service_role/i);
  });

  it('provides bounded exact-email and token-bucket RPCs only to the service role', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.admin_find_user_by_email/i);
    expect(sql).toMatch(/from\s+auth\.users[\s\S]*limit\s+1/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.admin_consume_user_search_token/i);
    expect(sql).toMatch(/least\s*\(\s*30[\s\S]*extract\s*\(\s*epoch/i);
    expect(sql).toMatch(/insert\s+into\s+public\.admin_user_search_buckets[\s\S]*on\s+conflict\s*\(\s*actor_id\s*\)\s+do\s+nothing/i);
    for (const fn of ['admin_find_user_by_email', 'admin_user_emails', 'admin_consume_user_search_token']) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*from\\s+anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*to\\s+service_role`, 'i'));
    }
  });

  it('grants analytics views and RPCs only to the service role', () => {
    const sql = schema();
    for (const view of ['analytics_branch_daily', 'analytics_branch_course_daily']) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${view}\\s+from\\s+public`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+select\\s+on\\s+public\\.${view}\\s+to\\s+service_role`, 'i'));
      expect(sql).not.toMatch(new RegExp(`grant\\s+select\\s+on\\s+public\\.${view}\\s+to\\s+(?:anon|authenticated)`, 'i'));
    }
  });
});

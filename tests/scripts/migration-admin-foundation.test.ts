import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSION_DEFINITIONS } from '@/lib/authorization';

const migrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260906065948_admin_authorization_foundation.sql',
);
const schema = () => existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('admin authorization foundation migration', () => {
  it('creates private account, membership, role definition and assignment tables', () => {
    const sql = schema();
    for (const table of ['permission_registry', 'user_accounts', 'branch_memberships', 'role_definitions', 'role_assignments']) {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon,\\s*authenticated`, 'i'));
    }
  });

  it('defines the fixed permission registry and protected built-in role presets', () => {
    const sql = schema();
    for (const permission of [
      'admin.access', 'member.read', 'member.manage', 'membership.manage',
      'role.definition.manage', 'role.assignment.global', 'role.assignment.branch',
      'branch.manage', 'content.read', 'content.edit', 'content.review.request',
      'content.review', 'content.publish', 'submission.grade', 'exam.release',
      'report.branch.read', 'report.global.read', 'audit.read',
    ]) expect(sql).toContain(`'${permission}'`);
    for (const role of ['central_admin', 'central_reviewer', 'central_editor', 'school_admin', 'school_editor', 'teacher', 'member']) {
      expect(sql).toContain(`'${role}'`);
    }
    expect(sql).toMatch(/cannot modify a built-in role definition/i);
  });

  it('keeps the SQL registry exactly aligned with the TypeScript registry', () => {
    // Later forward migrations extend the registry without editing its foundation.
    const registrySeed = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
      .filter(filename => filename.endsWith('.sql')).sort()
      .flatMap(filename => [...readFileSync(join(process.cwd(), 'supabase', 'migrations', filename), 'utf8')
        .matchAll(/insert\s+into\s+public\.permission_registry\s*\([^)]*\)\s*values([\s\S]*?);/gi)]
        .map(match => match[1])).join('\n');
    const entries = [...registrySeed.matchAll(/\('([^']+)',\s*'([^']+)',\s*'(any|central)'\)/g)]
      .map(([, permission, group, scope]) => [permission, { group, scope }] as const);

    expect(Object.fromEntries(entries)).toEqual(PERMISSION_DEFINITIONS);
  });

  it('exports service-only actor and scoped authorization functions with fixed search paths', () => {
    const sql = schema();
    for (const signature of [
      'authorization_actor\\(uuid\\)',
      'authorization_has_permission\\(uuid,\\s*text,\\s*text,\\s*text\\)',
      'authorization_assert_actor\\(uuid,\\s*text,\\s*text,\\s*text\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${signature}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*public,\\s*pg_temp`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s+to\\s+service_role`, 'i'));
    }
  });

  it('uses a transaction lock to protect the final active global central admin', () => {
    const sql = schema();
    expect(sql).toMatch(/select[\s\S]*from\s+public\.authorization_guard[\s\S]*for\s+update/i);
    expect(sql).toMatch(/cannot revoke or suspend the final global admin/i);
    expect(sql).toMatch(/create\s+trigger\s+role_assignments_protect_final_admin/i);
    expect(sql).toMatch(/create\s+trigger\s+user_accounts_protect_final_admin/i);
  });

  it('adds immutable point-in-time branch scope to learning and analytics history', () => {
    const sql = schema();
    for (const table of ['enrollments', 'assignment_submissions', 'exam_attempts', 'analytics_events']) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}[\\s\\S]*?branch_scope_known`, 'i'));
    }
    expect(sql).toMatch(/profile_at_enrollment/i);
    expect(sql).toMatch(/enrollment_snapshot/i);
    expect(sql).toMatch(/profile_at_event/i);
    expect(sql).toMatch(/historical branch scope is immutable/i);
  });

  it('guards protected learner writes without broadening public profile or catalog policies', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.enforce_active_account_write/i);
    for (const table of ['enrollments', 'lesson_progress', 'activity_state', 'quiz_attempts', 'exam_attempts', 'exam_answers', 'exam_attempt_events', 'assignment_submissions', 'submission_files']) {
      expect(sql).toMatch(new RegExp(`create\\s+trigger\\s+${table}_require_active_account`, 'i'));
    }
    expect(sql).not.toMatch(/alter\s+table\s+public\.(?:profiles|courses)\s+force\s+row\s+level\s+security/i);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = () => readFileSync(join(process.cwd(), 'supabase/migrations/20260907091001_studio_learning_reports.sql'), 'utf8');
const quizHistory = () => readFileSync(join(process.cwd(), 'supabase/migrations/20260907091000_quiz_attempt_branch_history.sql'), 'utf8');
const reviewPermissions = () => readFileSync(join(process.cwd(), 'supabase/migrations/20260907091002_review_queue_permissions.sql'), 'utf8');
const pgcryptoBridge = () => readFileSync(join(process.cwd(), 'supabase/migrations/20260907085959_cms_pgcrypto_schema.sql'), 'utf8');

describe('Studio learning reports migration', () => {
  it('uses Ho Chi Minh calendar dates and exact event dates', () => {
    expect(sql()).toContain("at time zone 'Asia/Ho_Chi_Minh'");
    expect(sql()).toMatch(/enrolled_at[\s\S]*between p_from and p_to/i);
    expect(sql()).toMatch(/completed_at < \(\(p_to \+ 1\)::timestamp at time zone 'Asia\/Ho_Chi_Minh'\)/i);
  });

  it('keeps per-kind weighted samples and pinned question versions', () => {
    expect(sql()).toContain("'sampleSize'");
    expect(sql()).toContain("'questionVersionId'");
    expect(sql()).toContain('grading_snapshot');
    expect(sql()).toContain('question_set');
    expect(sql()).toMatch(/case when attempt\.status = 'graded' then attempt\.percent else null end/i);
    expect(sql()).toMatch(/attempt\.status = 'graded'[\s\S]*answer\.result ->> 'status' in \('correct','partial','incorrect','self_assessed','incomplete'\)/i);
    expect(sql()).toContain("'{exam,passPercent}'");
    expect(sql()).toContain("'sourceRef'");
    expect(sql()).toContain('private.studio_report_text');
  });

  it('keeps the RPC service-role only and supports Central-only unknown history', () => {
    expect(sql()).toMatch(/p_include_unknown_historical_branch boolean/i);
    expect(sql()).toMatch(/revoke all on function public\.studio_learning_report[\s\S]*from public/i);
    expect(sql()).toMatch(/grant execute on function public\.studio_learning_report[\s\S]*to service_role/i);
    expect(sql()).toContain("'analytics.global.read'");
    expect(sql()).toContain("'analytics.branch.read'");
  });

  it('stores immutable quiz branch history and only backfills an exact enrolled version', () => {
    expect(quizHistory()).toMatch(/alter table public\.quiz_attempts[\s\S]*branch_scope_known/i);
    expect(quizHistory()).toMatch(/enrollment\.course_version_id = attempt\.course_version_id/i);
    expect(quizHistory()).toContain('Historical branch scope is immutable');
    expect(sql()).not.toMatch(/quiz_attempts attempt[\s\S]{0,500}join scoped_enrollments/i);
    expect(sql()).toMatch(/quiz_attempts attempt[\s\S]{0,500}attempt\.branch_scope_known/i);
  });

  it('lets Central review-only and publish-only roles read the protected review queue', () => {
    const migration = reviewPermissions();
    expect(migration.match(/'content\.review'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/'content\.publish'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toMatch(/revoke all on function public\.cms_list_reviews[\s\S]*from public, anon, authenticated/i);
  });

  it('resolves pgcrypto outside the security-definer search path before asset updates', () => {
    const migration = pgcryptoBridge();
    expect(migration).toContain("where extension.extname = 'pgcrypto'");
    expect(migration).toContain("format('select %I.digest($1, $2)', extension_schema)");
    expect(migration).toContain('public.cms_pgcrypto_digest(');
    expect(migration).toMatch(/revoke all on function public\.digest\(text, text\) from public, anon, authenticated, service_role/i);
  });
});

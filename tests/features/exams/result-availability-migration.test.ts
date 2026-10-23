import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The behavioural proof lives in scripts/verify-exam-result-availability.mjs, which
// runs the migration against a disposable PostgreSQL. These are the structural
// invariants worth failing the ordinary test run for.
const sql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260907092000_exam_result_availability.sql'),
  'utf8',
);

describe('20260907092000_exam_result_availability.sql', () => {
  it('adds result availability additively and never backfills it', () => {
    expect(sql).toMatch(/alter table public\.exam_attempts\s*\n\s*add column if not exists result_available_at timestamptz;/);
    // No default and no UPDATE: a historical attempt must stay unpublished.
    expect(sql).not.toMatch(/result_available_at timestamptz\s+(not null|default)/i);
    expect(sql).not.toMatch(/update public\.exam_attempts[\s\S]{0,400}?set result_available_at = (now\(\)|coalesce\(released_at)/i);
  });

  it('keeps a result timestamp meaningful only for a graded attempt', () => {
    expect(sql).toMatch(/check \(result_available_at is null or status = 'graded'\)/);
  });

  it('keeps the pre-availability finalize signature working for migrate-before-deploy', () => {
    // Migrations run before the running application is replaced, and a rollback puts
    // that application back in front of this schema. Dropping the 9-argument form
    // would break submissions in both windows.
    expect(sql).not.toMatch(/drop function if exists public\.exam_finalize_attempt\(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb\)/);
    const legacy = sql.slice(sql.lastIndexOf('create or replace function public.exam_finalize_attempt('));
    // It delegates to the 10-argument implementation with no availability, which is
    // the legacy behaviour verbatim.
    expect(legacy).toMatch(/p_answers jsonb\s*\n\)\s*\nreturns jsonb\s*\nlanguage sql/);
    expect(legacy).toMatch(/select public\.exam_finalize_attempt\([\s\S]{0,200}p_answers, null\s*\n?\s*\);/);
  });

  it('leaves no default on the tenth parameter, so neither arity is ambiguous', () => {
    const current = sql.slice(
      sql.indexOf('create or replace function public.exam_finalize_attempt('),
      sql.indexOf('-- Backward compatibility'),
    );
    expect(current).toMatch(/p_result_available_at timestamptz\s*\n\)/);
    expect(current).not.toMatch(/p_result_available_at timestamptz\s+default/);
  });

  it('gives the manual draft the same attempt-row lock as completion', () => {
    for (const fn of ['exam_save_manual_draft', 'exam_complete_manual_grading']) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      expect(body).toMatch(/from public\.exam_attempts as attempt\s*\n\s*where attempt\.id = p_attempt_id\s*\n\s*for update;/);
    }
  });

  it('never lets completion write the answer-key release timestamp', () => {
    const completion = sql.slice(
      sql.indexOf('create or replace function public.exam_complete_manual_grading('),
      sql.indexOf('revoke all on function public.exam_save_manual_draft'),
    );
    expect(completion).toMatch(/set status = 'graded'/);
    expect(completion).not.toMatch(/released_at\s*=/);
  });

  it('preserves the first result timestamp on a repeated completion', () => {
    expect(sql).toMatch(/result_available_at = coalesce\(result_available_at, p_result_available_at\)/);
  });

  it('compares manual points as well as answers before completing', () => {
    expect(sql).toMatch(/jsonb_build_object\('answer', answer\.answer, 'manualPoints', answer\.manual_points\)/);
  });

  it('keeps every new grading function service-role only', () => {
    const signatures = [
      'public.exam_save_manual_draft(uuid, jsonb)',
      'public.exam_complete_manual_grading(uuid, numeric, numeric, numeric, timestamptz, jsonb, jsonb)',
      'public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb, timestamptz)',
      // The compatibility overload is locked down exactly like the rest.
      'public.exam_finalize_attempt(uuid, text, boolean, timestamptz, numeric, numeric, numeric, jsonb, jsonb)',
    ];
    for (const signature of signatures) {
      const escaped = signature.replace(/[.()*+?^${}|[\]\\]/g, '\\$&');
      expect(sql).toMatch(new RegExp(`revoke all on function ${escaped} from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function ${escaped} to service_role;`));
    }
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
  });

  it('reports an exam as published on either timestamp', () => {
    const report = sql.slice(sql.indexOf('create or replace function public.studio_learning_report('));
    expect(
      [...report.matchAll(/attempt\.released_at is not null or attempt\.result_available_at is not null/g)],
    ).toHaveLength(2);
    expect(report).toMatch(
      /where attempt\.status = 'graded'\s*\n\s*and attempt\.released_at is null and attempt\.result_available_at is null/,
    );
    // No exam publication predicate may look at released_at alone any more.
    expect(report).not.toMatch(/p_publication = 'released' and attempt\.released_at is not null\)/);
    expect(report).not.toMatch(/p_publication = 'released' and released\)[\s\S]{0,80}exam_attempts/);
  });

  it('sends report question drill-through to the canonical grading queue', () => {
    expect(sql).toMatch(/'sourceHref','\/grading\/queue\?kind=exam/);
    expect(sql).not.toMatch(/'sourceHref','\/studio\/grading/);
  });
});

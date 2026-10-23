import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0027_guard_assignment_lifecycle.sql'), 'utf8');

describe('0027 guarded assignment lifecycle', () => {
  it('serializes submit and grade on the same complete assignment locator', () => {
    expect(sql.match(/pg_advisory_xact_lock/gi)).toHaveLength(2);
    expect(sql.match(/course_version_id/gi)?.length).toBeGreaterThan(10);
    expect(sql).toMatch(/block_id\s+is\s+not\s+distinct\s+from\s+p_block_id/i);
    expect(sql).toMatch(/newer\.block_id\s+is\s+not\s+distinct\s+from\s+stored_submission\.block_id/i);
    expect(sql).toMatch(/raise exception 'STALE_SUBMISSION'/i);
  });

  it('makes exact retries idempotent before checking the expected latest id', () => {
    const equality = sql.indexOf('latest_submission.payload = p_payload');
    const stale = sql.indexOf("raise exception 'SUBMISSION_STALE'");
    expect(equality).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(equality);
    expect(sql).toMatch(/'created', false/i);
    expect(sql).toMatch(/existing_files\s*=\s*requested_files/i);
  });

  it('computes attempts and enforces all immutable resubmission policies under lock', () => {
    expect(sql).not.toMatch(/p_attempt_no/i);
    expect(sql).toMatch(/existing_attempts\s*\+\s*1/i);
    expect(sql).toMatch(/p_resubmission\s*=\s*'never'/i);
    expect(sql).toMatch(/p_resubmission\s*=\s*'once'/i);
    expect(sql).toMatch(/grade\.released\s*=\s*true[\s\S]*grade\.decision\s*=\s*'changes_requested'/i);
    expect(sql).toMatch(/ASSIGNMENT_ALREADY_APPROVED/i);
    expect(sql).toMatch(/ATTEMPT_LIMIT/i);
  });

  it('keeps grading drafts private and returns the one-time released approval transition', () => {
    expect(sql).toMatch(/next_status\s*:=\s*case when p_released then p_decision else 'in_review' end/i);
    expect(sql).toMatch(/existing_grade\.released\s*=\s*true[\s\S]*existing_grade\.decision\s*=\s*'approved'/i);
    expect(sql).toMatch(/'became_released_approved', became_released_approved/i);
  });

  it('keeps both RPCs service-role-only with fixed search paths', () => {
    expect(sql.match(/security definer/gi)).toHaveLength(2);
    expect(sql.match(/set search_path = public, pg_temp/gi)).toHaveLength(2);
    expect(sql.match(/from anon, authenticated/gi)).toHaveLength(2);
    expect(sql.match(/to service_role/gi)).toHaveLength(2);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0032_fix_pending_grading_latest_assignment.sql', 'utf8');

describe('migration 0032 pending grading workload', () => {
  it('counts only the latest exact assignment locator while retaining pending manual exams', () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.analytics_pending_grading/i);
    expect(sql).toMatch(/distinct\s+on\s*\(\s*submission\.user_id\s*,\s*submission\.course_version_id\s*,\s*submission\.item_id\s*,\s*submission\.block_id\s*\)/i);
    expect(sql).toMatch(/submission\.attempt_no\s+desc\s*,\s*submission\.id\s+desc/i);
    expect(sql).toMatch(/from\s+latest_assignment\s+where\s*\(\s*status\s+in\s*\(\s*'submitted'\s*,\s*'in_review'\s*\)/i);
    expect(sql).toMatch(/status\s+in\s*\(\s*'approved'\s*,\s*'changes_requested'\s*\)\s+and\s+released\s+is\s+not\s+true/i);
    expect(sql).toMatch(/not\s+exists\s*\([\s\S]*approved_submission\.block_id\s+is\s+not\s+distinct\s+from\s+latest_assignment\.block_id[\s\S]*approved_grade\.released\s*=\s*true[\s\S]*approved_grade\.decision\s*=\s*'approved'/i);
    expect(sql).toMatch(/pending_exam\.status\s*=\s*'pending_manual'/i);
  });

  it('keeps the function service-role only', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.analytics_pending_grading\(text\)\s+from\s+anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.analytics_pending_grading\(text\)\s+to\s+service_role/i);
  });
});

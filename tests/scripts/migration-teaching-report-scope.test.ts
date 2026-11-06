import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261106030000_teaching_report_scope.sql', 'utf8');

describe('teaching report scope migration', () => {
  it('filters each report source by course and historical branch before aggregation', () => {
    const before = sql.slice(0, sql.indexOf('selected_attempts as'));
    expect(before).toMatch(/teaching_has_course_permission\(p_actor_user_id, 'report\.branch\.read', enrollment\.course_id, case when enrollment\.branch_scope_known then enrollment\.branch_id else null end\)/);
    expect(before.match(/teaching_has_course_permission\(p_actor_user_id, 'report\.branch\.read', version\.course_id, case when attempt\.branch_scope_known/g)).toHaveLength(2);
    expect(before).toContain("'report.branch.read', version.course_id, case when submission.branch_scope_known");
    expect(sql).toContain("'report.branch.read', event.props ->> 'courseId', case when event.branch_scope_known");
    expect(sql.match(/'report\.branch\.read', version\.course_id, case when attempt\.branch_scope_known/g)).toHaveLength(6);
    expect(sql.match(/'report\.branch\.read', version\.course_id, case when submission\.branch_scope_known/g)).toHaveLength(2);
  });
});

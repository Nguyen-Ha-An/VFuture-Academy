import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('teaching migration', () => {
  it('guards revisions and removes the unguarded delete function', () => {
    const sql = readFileSync('supabase/migrations/20261105010000_teaching_announcement_revisions.sql', 'utf8');
    expect(sql).toContain('new.revision := old.revision + 1');
    expect(sql).toContain('drop function public.delete_teaching_announcement(uuid,uuid)');
    expect(sql).toContain("status='draft' and revision=p_expected_revision");
    expect(sql).toContain("'revision',deleted.revision");
  });
  it('stores school-scoped schedules and snapshots deadlines only at insertion', () => {
    const sql = readFileSync('supabase/migrations/20261105000000_teaching_canvas.sql', 'utf8');
    expect(sql).toContain('unique nulls not distinct (branch_id, course_version_id, item_id, block_id)');
    expect(sql).toContain('before insert on public.assignment_submissions');
    expect(sql).toContain('new.submitted_at > new.due_at_snapshot');
    expect(sql).toContain('alter table public.assignment_schedules enable row level security');
  });
});

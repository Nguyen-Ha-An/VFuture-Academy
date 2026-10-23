import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(process.cwd(), 'supabase', 'migrations', '0024_guard_studio_replace_draft.sql');
const sql = readFileSync(path, 'utf8');

describe('migration 0024 guarded draft replacement', () => {
  it('adds a separately named exact-revision RPC without replacing the legacy signature', () => {
    expect(sql).toMatch(/create\s+function\s+public\.studio_replace_draft_if_current\s*\(/i);
    expect(sql).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+public\.studio_replace_draft\s*\(/i);
    expect(sql).toMatch(/expected_updated_at\s+timestamptz/i);
  });

  it('checks and reserves the expected revision before replacing any item rows', () => {
    const revisionCheck = sql.search(/where\s+draft\.course_id\s*=\s*requested_course_id[\s\S]*?draft\.updated_at\s*=\s*requested_updated_at/i);
    const conflictReturn = sql.search(/if\s+target_draft_id\s+is\s+null[\s\S]*?'conflict',\s*true/i);
    const itemDelete = sql.search(/delete\s+from\s+public\.course_draft_items/i);
    expect(revisionCheck).toBeGreaterThan(0);
    expect(conflictReturn).toBeGreaterThan(revisionCheck);
    expect(itemDelete).toBeGreaterThan(conflictReturn);
  });

  it('keeps the guarded RPC service-role only', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.studio_replace_draft_if_current[\s\S]*?from\s+public/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.studio_replace_draft_if_current[\s\S]*?from\s+anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.studio_replace_draft_if_current[\s\S]*?to\s+service_role/i);
  });
});

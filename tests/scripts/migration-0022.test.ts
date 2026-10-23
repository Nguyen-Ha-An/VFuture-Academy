import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const path = join(process.cwd(), 'supabase', 'migrations', '0022_fix_studio_replace_draft_conflict.sql');

describe('migration 0022 Studio draft replacement repair', () => {
  it('uses the named course draft uniqueness constraint to avoid PL/pgSQL parameter ambiguity', () => {
    expect(existsSync(path)).toBe(true);
    const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_replace_draft/i);
    expect(sql).toMatch(/on\s+conflict\s+on\s+constraint\s+course_drafts_course_id_key\s+do\s+update/i);
    expect(sql).not.toMatch(/on\s+conflict\s*\(\s*course_id\s*\)/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.studio_replace_draft\s*\(\s*text,\s*jsonb,\s*jsonb,\s*uuid\s*\)\s+to\s+service_role/i);
  });
});

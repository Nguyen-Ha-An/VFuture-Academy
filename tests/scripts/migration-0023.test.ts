import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const originalPath = join(process.cwd(), 'supabase', 'migrations', '0011_learning_progress_functions.sql');
const repairPath = join(process.cwd(), 'supabase', 'migrations', '0023_fix_completion_effect_conflict.sql');

describe('migration 0023 completion transition repair', () => {
  it('replaces only the ambiguous effect conflict target with its named constraint', () => {
    expect(existsSync(repairPath)).toBe(true);
    const original = readFileSync(originalPath, 'utf8');
    const repair = existsSync(repairPath) ? readFileSync(repairPath, 'utf8') : '';

    expect(original).toMatch(/on\s+conflict\s*\(\s*user_id\s*,\s*course_id\s*\)\s+do\s+nothing/i);
    expect(repair).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_complete_course/i);
    expect(repair).toMatch(/on\s+conflict\s+on\s+constraint\s+course_completion_effects_user_id_course_id_key\s+do\s+nothing/i);
    expect(repair).not.toMatch(/on\s+conflict\s*\(\s*user_id\s*,\s*course_id\s*\)/i);
  });

  it('preserves the security and transition contract', () => {
    const repair = existsSync(repairPath) ? readFileSync(repairPath, 'utf8') : '';

    expect(repair).toMatch(/returns\s+table\s*\([\s\S]*user_id\s+uuid[\s\S]*transitioned\s+boolean/i);
    expect(repair).toMatch(/security\s+definer[\s\S]*set\s+search_path\s*=\s*public,\s*pg_temp/i);
    expect(repair).toMatch(/on\s+conflict\s+on\s+constraint\s+course_completions_pkey\s+do\s+nothing/i);
    expect(repair).toMatch(/if\s+coalesce\(did_transition,\s*false\)[\s\S]*insert\s+into\s+public\.course_completion_effects/i);
    expect(repair).toMatch(/update\s+public\.enrollments\s+e[\s\S]*status\s*=\s*'completed'/i);
    expect(repair).toMatch(/revoke\s+all\s+on\s+function\s+public\.learner_complete_course\s*\(\s*uuid,\s*text,\s*uuid,\s*timestamptz\s*\)\s+from\s+public/i);
    expect(repair).toMatch(/grant\s+execute\s+on\s+function\s+public\.learner_complete_course\s*\(\s*uuid,\s*text,\s*uuid,\s*timestamptz\s*\)\s+to\s+service_role/i);
  });
});

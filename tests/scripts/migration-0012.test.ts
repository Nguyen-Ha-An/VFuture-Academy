import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const path = join(process.cwd(), 'supabase', 'migrations', '0012_usage_lookups.sql');

describe('migration 0012 usage lookups and atomic course creation', () => {
  it('adds one parameterised batch lookup for every requested bank question', () => {
    expect(existsSync(path)).toBe(true);
    const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

    expect(sql).toMatch(/studio_bank_question_usages_batch\s*\(\s*p_question_ids\s+text\[\]/i);
    expect(sql).toMatch(/unnest\s*\(\s*p_question_ids\s*\)/i);
    expect(sql).toMatch(/jsonb_path_exists[\s\S]*?\"\$ref\"/i);
    expect(sql).toMatch(/jsonb_path_exists[\s\S]*?\"\$pool\"\.from/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.studio_bank_question_usages_batch\s*\(\s*text\[\]\s*\)\s+to\s+service_role/i);
  });

  it('creates the course shell and draft in one database transaction', () => {
    const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

    expect(sql).toMatch(/studio_create_course\s*\(\s*p_course_id\s+text,\s*p_actor_id\s+uuid,\s*p_manifest\s+jsonb/i);
    expect(sql).toMatch(/insert\s+into\s+public\.courses/i);
    expect(sql).toMatch(/insert\s+into\s+public\.course_drafts/i);
    expect(sql).toMatch(/jsonb_build_object\s*\(\s*'course',[\s\S]*?'draft'/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.studio_create_course\s*\(\s*text,\s*uuid,\s*jsonb\s*\)\s+to\s+service_role/i);
  });
});

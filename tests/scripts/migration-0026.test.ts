import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = () => readFileSync(join(process.cwd(), 'supabase/migrations/0026_atomic_exam_release.sql'), 'utf8');

describe('0026 atomic exam release', () => {
  it('locks one graded attempt and preserves an existing release timestamp', () => {
    const source = sql();

    expect(source).toMatch(/create\s+or\s+replace\s+function\s+public\.exam_release_attempt/i);
    expect(source).toMatch(/from\s+public\.exam_attempts[\s\S]*?for\s+update/i);
    expect(source).toMatch(/status\s*<>\s*'graded'[\s\S]*?released_at\s+is\s+not\s+null/i);
    expect(source).toMatch(/where\s+id\s*=\s*p_attempt_id[\s\S]*?status\s*=\s*'graded'[\s\S]*?released_at\s+is\s+null/i);
  });

  it('keeps the release transition service-role only', () => {
    const source = sql();

    expect(source).toMatch(/security\s+definer[\s\S]*?set\s+search_path\s*=\s*public,\s*pg_temp/i);
    expect(source).toMatch(/revoke\s+all\s+on\s+function\s+public\.exam_release_attempt[\s\S]*?from\s+public,\s*anon,\s*authenticated/i);
    expect(source).toMatch(/grant\s+execute\s+on\s+function\s+public\.exam_release_attempt[\s\S]*?to\s+service_role/i);
  });
});

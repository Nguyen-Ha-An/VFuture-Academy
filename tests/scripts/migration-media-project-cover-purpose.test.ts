import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260926090000_media_project_cover_purpose.sql', 'utf8');
const statements = sql.replace(/--.*$/gm, '').split(';').map((statement) => statement.trim()).filter(Boolean);

describe('media project_cover purpose migration', () => {
  it('replaces the purpose check with exactly the four server-assigned purposes', () => {
    const check = sql.match(/check\s*\(\s*purpose\s+in\s*\(([^)]*)\)\s*\)/i);

    expect(check).not.toBeNull();
    expect(check![1].split(',').map((value) => value.trim())).toEqual([
      "'content'", "'avatar'", "'submission'", "'project_cover'",
    ]);
  });

  it('drops, re-adds not valid, then validates the constraint', () => {
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^alter\s+table\s+public\.media_assets\s+drop\s+constraint\s+media_assets_purpose_check$/i);
    expect(statements[1]).toMatch(/^alter\s+table\s+public\.media_assets\s+add\s+constraint\s+media_assets_purpose_check\s+check\s*\([\s\S]*\)\s+not\s+valid$/i);
    expect(statements[2]).toMatch(/^alter\s+table\s+public\.media_assets\s+validate\s+constraint\s+media_assets_purpose_check$/i);
  });

  it('contains no data changes', () => {
    expect(statements.join(';')).not.toMatch(/\b(insert|update|delete|truncate|merge)\b/i);
  });
});

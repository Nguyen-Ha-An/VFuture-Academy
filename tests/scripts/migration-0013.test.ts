import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function schema() {
  const directory = join(process.cwd(), 'supabase/migrations');
  const filename = readdirSync(directory).find((entry) => entry.endsWith('_project_approval.sql'));
  if (!filename) throw new Error('Project approval migration was not found');
  return readFileSync(join(directory, filename), 'utf8');
}

describe('project approval migration', () => {
  it('adds a required false-by-default approval flag without rewriting migration 0007', () => {
    expect(schema()).toMatch(
      /alter\s+table\s+public\.projects\s+add\s+column\s+approved\s+boolean\s+not\s+null\s+default\s+false/i,
    );
  });

  it('lets authenticated learners read approved projects or their own proposal within branch scope', () => {
    const sql = schema();

    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+"published projects readable when scoped"\s+on\s+public\.projects/i);
    expect(sql).toMatch(
      /create\s+policy\s+"approved projects or own proposals readable when scoped"[\s\S]*?for\s+select\s+to\s+authenticated[\s\S]*?approved\s+or\s+owner_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)[\s\S]*?branch_scope/i,
    );
  });

  it('indexes approval visibility and owner daily proposal checks', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+index\s+projects_approved_created_at\s+on\s+public\.projects\s*\(created_at\s+desc\)\s+where\s+approved/i);
    expect(sql).toMatch(/create\s+index\s+projects_owner_created_at\s+on\s+public\.projects\s*\(owner_id,\s*created_at\s+desc\)/i);
  });
});

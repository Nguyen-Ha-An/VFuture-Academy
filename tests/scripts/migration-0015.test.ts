import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function schema() {
  const directory = join(process.cwd(), 'supabase/migrations');
  const filename = readdirSync(directory).find((entry) => entry.endsWith('_project_scope_hardening.sql'));
  if (!filename) throw new Error('Project scope hardening migration was not found');
  return readFileSync(join(directory, filename), 'utf8');
}

describe('project branch-scope hardening migration', () => {
  it('defines a strict immutable branch-scope shape validator', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.valid_project_branch_scope\s*\(\s*value\s+jsonb\s*\)/i);
    expect(sql).toMatch(/immutable/i);
    expect(sql).toMatch(/jsonb_array_elements/i);
  });

  it('makes malformed existing scopes private before adding the shape constraint', () => {
    const sql = schema();
    expect(sql).toMatch(/update\s+public\.projects[\s\S]*?approved\s*=\s*false[\s\S]*?branch_scope\s*=\s*'\{"scope":"global"\}'::jsonb[\s\S]*?not\s+public\.valid_project_branch_scope/i);
    expect(sql).toMatch(/add\s+constraint\s+projects_branch_scope_shape\s+check\s*\(public\.valid_project_branch_scope\(branch_scope\)\)/i);
  });
});

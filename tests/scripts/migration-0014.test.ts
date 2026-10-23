import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function schema() {
  const directory = join(process.cwd(), 'supabase/migrations');
  const filename = readdirSync(directory).find((entry) => entry.endsWith('_project_workflows.sql'));
  if (!filename) throw new Error('Project workflow migration was not found');
  return readFileSync(join(directory, filename), 'utf8');
}

describe('atomic project workflow migration', () => {
  it('saves the project and replacement members in one Studio transaction', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_project_save\s*\(/i);
    expect(sql).toMatch(/delete\s+from\s+public\.project_members[\s\S]*?insert\s+into\s+public\.project_members/i);
  });

  it('serializes daily proposal checks and creates proposals atomically', () => {
    const sql = schema();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_project_propose\s*\([\s\S]*?p_since\s+timestamptz[\s\S]*?p_limit\s+integer/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/count\s*\(\s*\*\s*\)[\s\S]*?created_at\s*>=\s*p_since/i);
    expect(sql).toMatch(/proposal_count\s*>=\s*p_limit/i);
    expect(sql).toMatch(/PROJECT_PROPOSAL_LIMIT/);
  });

  it('allows only the service role to execute either workflow', () => {
    const sql = schema();
    for (const signature of ['studio_project_save(jsonb, jsonb, boolean)', 'learner_project_propose(jsonb, jsonb, uuid, timestamptz, integer)']) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature.replace(/[()]/g, '\\$&')}\\s+from\\s+public`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature.replace(/[()]/g, '\\$&')}\\s+to\\s+service_role`, 'i'));
    }
  });
});

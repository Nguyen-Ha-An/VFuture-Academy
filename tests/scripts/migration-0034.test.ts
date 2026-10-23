import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0034_studio_atomic_workspace.sql'), 'utf8');

describe('Studio atomic workspace migration', () => {
  it('defines snapshot, guarded save, import, and publish transactions', () => {
    expect(sql).toMatch(/function\s+public\.studio_get_draft_snapshot/i);
    expect(sql).toMatch(/function\s+public\.studio_save_draft_workspace/i);
    expect(sql).toMatch(/function\s+public\.studio_import_course/i);
    expect(sql).toMatch(/function\s+public\.studio_publish_version_guarded/i);
    expect(sql).toMatch(/for\s+update/i);
    expect(sql).toMatch(/current_updated_at\s+is\s+distinct\s+from\s+requested_updated_at/i);
    expect(sql).toMatch(/insert\s+into\s+public\.skills[\s\S]*on\s+conflict\s*\(id\)\s+do\s+nothing/i);
    expect(sql.indexOf("return jsonb_build_object('conflict', true)")).toBeLessThan(sql.indexOf('insert into public.skills'));
  });

  it('preserves the base version unless a verified version was explicitly requested', () => {
    expect(sql).toMatch(/version_row\.id\s*=\s*requested_base_id/i);
    expect(sql).toMatch(/version_row\.course_id\s*=\s*requested_course_id/i);
    expect(sql).toMatch(/case\s+when\s+should_set_base\s+then\s+requested_base_id\s+else\s+draft\.base_version_id\s+end/i);
  });

  it('exposes every new function only to service_role', () => {
    expect(sql.match(/security\s+definer/gi)).toHaveLength(4);
    expect(sql.match(/set\s+search_path\s*=\s*public,\s*pg_temp/gi)).toHaveLength(4);
    expect(sql.match(/revoke\s+all\s+on\s+function[\s\S]*?from\s+public,\s*anon,\s*authenticated/gi)).toHaveLength(4);
    expect(sql.match(/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role/gi)).toHaveLength(4);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0009_public_profiles.sql');
const schema = () => existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('0009_public_profiles.sql', () => {
  it('creates a security-invoker projection containing only public profiles and approved columns', () => {
    const sql = schema();

    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?view\s+public\.public_profiles\s+with\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    expect(sql).toMatch(/select\s+p\.id\s*,\s*p\.handle\s*,\s*p\.display_name\s*,\s*p\.avatar_url\s*,\s*b\.name\s+as\s+branch_name\s+from\s+public\.profiles\s+p\s+left\s+join\s+public\.branches\s+b/i);
    expect(sql).not.toMatch(/p\.branch_id\s*,/i);
    expect(sql).not.toMatch(/select\s+\*/i);
  });

  it('counts valid handle attempts before no-op and uniqueness checks in the atomic limiter', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+table\s+public\.profile_handle_changes/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.profile_change_handle/i);
    expect(sql).toMatch(/changed_at\s*>=\s*p_now\s*-\s*interval\s+'24 hours'/i);
    expect(sql).toMatch(/if\s+change_count\s*>=\s*3/i);
    expect(sql).toMatch(/HANDLE_RATE_LIMITED/i);
    expect(sql).toMatch(/exception\s+when\s+unique_violation[\s\S]*?HANDLE_TAKEN/i);
    const countAt = sql.search(/select\s+count\(\*\)::integer\s+into\s+change_count/i);
    const attemptAt = sql.search(/insert\s+into\s+public\.profile_handle_changes/i);
    const noOpAt = sql.search(/if\s+current_profile\.handle\s+is\s+not\s+distinct\s+from\s+p_handle/i);
    const uniquenessAt = sql.search(/update\s+public\.profiles\s+as\s+profile/i);
    expect(countAt).toBeGreaterThan(-1);
    expect(attemptAt).toBeGreaterThan(countAt);
    expect(noOpAt).toBeGreaterThan(attemptAt);
    expect(uniquenessAt).toBeGreaterThan(attemptAt);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role/i);
  });
});

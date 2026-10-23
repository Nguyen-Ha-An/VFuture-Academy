import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function completionEffectsMigration() {
  const directory = join(process.cwd(), 'supabase', 'migrations');
  const matches = readdirSync(directory).filter((name) => name.endsWith('_completion_effects.sql'));
  expect(matches).toEqual(['0016_completion_effects.sql']);
  return readFileSync(join(directory, matches[0]), 'utf8');
}

describe('completion-effects migration', () => {
  it('provisions a private, non-listable certificate bucket', () => {
    const sql = completionEffectsMigration();

    expect(sql).toMatch(/values\s*\(\s*'certificates',\s*'certificates',\s*false\s*\)/i);
    expect(sql).not.toMatch(/create\s+policy[^;]+on\s+storage\.objects[^;]+to\s+(?:anon|public)/i);
  });

  it('aggregates weekly leaderboards and user totals in hardened service-role RPCs', () => {
    const sql = completionEffectsMigration();

    for (const functionName of ['xp_weekly_leaderboard', 'xp_user_total']) {
      expect(sql).toMatch(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}`, 'i'));
      expect(sql).toMatch(new RegExp(`${functionName}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*public,\\s*pg_temp`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?from\\s+anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?to\\s+service_role`, 'i'));
    }
    expect(sql.match(/sum\s*\(\s*(?:\w+\.)?points\s*\)/gi)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/group\s+by\s+(?:\w+\.)?user_id/gi)?.length).toBeGreaterThanOrEqual(2);
  });

  it('updates streaks through one atomic upsert that preserves the longest value', () => {
    const sql = completionEffectsMigration();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.xp_update_streak/i);
    expect(sql).toMatch(/insert\s+into\s+public\.streaks[\s\S]*?on\s+conflict\s*\(user_id\)\s+do\s+update/i);
    expect(sql).toMatch(/longest_streak\s*=\s*greatest\s*\(/i);
  });
});

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0002_content.sql');
const schema = () => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');
const studioFunctionsPath = join(process.cwd(), 'supabase', 'migrations', '0003_studio_functions.sql');
const studioFunctions = () => (existsSync(studioFunctionsPath) ? readFileSync(studioFunctionsPath, 'utf8') : '');

const expectedTables = [
  'courses',
  'course_drafts',
  'course_draft_items',
  'course_versions',
  'course_version_items',
  'course_version_item_renders',
  'course_version_outline',
  'publish_events',
  'media_assets',
  'bank_questions',
  'bank_question_versions',
  'audit_log',
];

function createdTables(sql: string) {
  return [...sql.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)].map((match) => match[1].toLowerCase());
}

describe('0002_content.sql', () => {
  it('is an immutable forward-only content migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(schema()).toMatch(/irreversible/i);
  });

  it('creates the complete content data model with row-level security on every new table', () => {
    const sql = schema();

    expect(createdTables(sql)).toEqual(expectedTables);
    for (const table of createdTables(sql)) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    }
  });

  it('keeps content tables server-only until Plan 3 access policies are introduced', () => {
    expect(schema()).not.toMatch(/create\s+policy/i);
  });

  it('preserves the immutable published-version, render, and grading boundaries', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+table\s+public\.course_versions[\s\S]*?unique\s*\(course_id,\s*version\)/i);
    expect(sql).toMatch(/create\s+table\s+public\.course_version_items[\s\S]*?source\s+jsonb\s+not\s+null[\s\S]*?grading\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/create\s+table\s+public\.course_version_item_renders[\s\S]*?payload\s+jsonb\s+not\s+null[\s\S]*?foreign\s+key\s*\(version_id,\s*item_id\)\s+references\s+public\.course_version_items/i);
    expect(sql).toMatch(/answer keys?[^\n]*(?:never|not)[^\n]*(?:render|payload)|(?:render|payload)[^\n]*(?:never|not)[^\n]*answer keys?/i);
  });

  it('enforces the specified identifiers, statuses, relationships, and tag index', () => {
    const sql = schema();

    expect(sql).toMatch(/courses\s*\(\s*id\s+text\s+primary\s+key\s+check\s*\(id\s*~\s*'\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$'/i);
    expect(sql).toMatch(/bank_questions\s*\(\s*id\s+text\s+primary\s+key\s+check\s*\(id\s*~\s*'\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$'/i);
    expect(sql).toMatch(/status\s+text\s+not\s+null\s+default\s+'draft'\s+check\s*\(status\s+in\s*\('draft',\s*'published',\s*'archived'\)\)/i);
    expect(sql).toMatch(/add\s+constraint\s+courses_current_version_fk\s+foreign\s+key\s*\(current_version_id\)\s+references\s+public\.course_versions\s*\(id\)/i);
    expect(sql).toMatch(/create\s+index\s+bank_questions_tags\s+on\s+public\.bank_questions\s+using\s+gin\s*\(tags\)/i);
  });

  it('documents the private media and submission buckets and public certificate reads', () => {
    const sql = schema();

    expect(sql).toMatch(/media[^\n]*(?:private|editors?[^\n]*upload)/i);
    expect(sql).toMatch(/submissions[^\n]*(?:private|userId\/|user_id\/)[^\n]*(?:upload|prefix)/i);
    expect(sql).toMatch(/certificates[^\n]*(?:public|read)/i);
  });
});

describe('0003_studio_functions.sql', () => {
  it('defines security-definer draft replacement and version publishing functions', () => {
    const sql = studioFunctions();

    expect(existsSync(studioFunctionsPath)).toBe(true);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_replace_draft\s*\(\s*course_id\s+text,\s*manifest\s+jsonb,\s*items\s+jsonb,\s*base_version_id\s+uuid\s+default\s+null\s*\)/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_publish_version\s*\(/i);
    expect(sql.match(/security\s+definer/gi)).toHaveLength(2);
    expect(sql.match(/set\s+search_path\s*=\s*public,\s*pg_temp/gi)).toHaveLength(2);
  });

  it('atomically replaces every item in the active draft', () => {
    const sql = studioFunctions();

    expect(sql).toMatch(/insert\s+into\s+public\.course_drafts[\s\S]*?on\s+conflict\s*\(course_id\)\s+do\s+update/i);
    expect(sql).toMatch(/delete\s+from\s+public\.course_draft_items[\s\S]*?draft_id/i);
    expect(sql).toMatch(/jsonb_each\s*\(requested_items\)/i);
    expect(sql).not.toMatch(/jsonb_each\s*\(items\)/i);
    expect(sql).toMatch(/insert\s+into\s+public\.course_draft_items/i);
    expect(sql).toMatch(/base_version_id\s*=\s*excluded\.base_version_id/i);
  });

  it('serializes max-plus-one allocation and writes the complete immutable publish snapshot', () => {
    const sql = studioFunctions();

    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/coalesce\s*\(\s*max\s*\(\s*(?:cv\.)?version\s*\),\s*0\s*\)\s*\+\s*1/i);
    for (const table of ['course_versions', 'course_version_items', 'course_version_item_renders', 'course_version_outline', 'publish_events']) {
      expect(sql).toMatch(new RegExp(`insert\\s+into\\s+public\\.${table}`, 'i'));
    }
    expect(sql).toMatch(/update\s+public\.courses[\s\S]*?current_version_id[\s\S]*?status\s*=\s*'published'/i);
    expect(sql).toMatch(/insert\s+into\s+public\.audit_log\s*\([\s\S]*?requested_audit_row[\s\S]*?next_version/i);
  });

  it('accepts the publish audit row as part of the publishing transaction', () => {
    const sql = studioFunctions();

    expect(sql).toMatch(/studio_publish_version\s*\([\s\S]*?audit_row\s+jsonb\s*\)/i);
    expect(sql).toMatch(/requested_audit_row\s+alias\s+for\s+\$8/i);
  });

  it('revokes public and authenticated execution and grants only the service role', () => {
    const sql = studioFunctions();

    for (const name of ['studio_replace_draft', 'studio_publish_version']) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?from\\s+public`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?from\\s+anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?to\\s+service_role`, 'i'));
    }
  });
});

describe('migration RLS invariant', () => {
  it('enables row-level security for every table created by every migration', () => {
    const directory = join(process.cwd(), 'supabase', 'migrations');
    for (const filename of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(directory, filename), 'utf8');
      for (const table of createdTables(sql)) {
        expect(sql, `${filename}: ${table}`).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      }
    }
  });
});

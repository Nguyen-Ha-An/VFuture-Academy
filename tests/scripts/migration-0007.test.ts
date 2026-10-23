import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0007_ecosystem.sql');
const schema = () => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

const ecosystemTables = [
  'resources',
  'opportunities',
  'opportunity_interest',
  'projects',
  'project_members',
  'project_interest',
  'skills',
  'skill_evidence',
  'certificates',
  'xp_events',
  'streaks',
  'analytics_events',
];

const scopedPublishedTables = ['resources', 'opportunities', 'projects'];
const selectOwnTables = [
  'opportunity_interest',
  'project_members',
  'project_interest',
  'skill_evidence',
  'certificates',
  'xp_events',
  'streaks',
];

function createdTables(sql: string) {
  return [...sql.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)].map((match) => match[1].toLowerCase());
}

function sqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function policiesForTable(statements: string[], table: string) {
  return statements.filter((statement) =>
    new RegExp(`\\bcreate\\s+policy\\b[\\s\\S]*?\\bon\\s+public\\.${table}\\b`, 'i').test(statement),
  );
}

function tableDefinition(sql: string, table: string) {
  const match = sql.match(new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  return match?.[1] ?? '';
}

function checkedValues(sql: string, table: string, column: string) {
  const definition = tableDefinition(sql, table);
  const match = definition.match(
    new RegExp(
      `${column}\\s+text\\s+not\\s+null(?:\\s+default\\s+'[^']+')?\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`,
      'i',
    ),
  );

  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]) : [];
}

describe('0007_ecosystem.sql', () => {
  it('creates every ecosystem and completion-effect table with RLS enabled afterward', () => {
    const sql = schema();
    const statements = sqlStatements(sql);

    expect(existsSync(migrationPath)).toBe(true);
    expect(createdTables(sql)).toEqual(ecosystemTables);
    for (const table of ecosystemTables) {
      expect(tableDefinition(sql, table)).toMatch(/primary\s+key/i);

      const createTableIndex = statements.findIndex((statement) =>
        new RegExp(`\\bcreate\\s+table\\s+public\\.${table}\\b`, 'i').test(statement),
      );
      const enableRlsIndex = statements.findIndex((statement) =>
        new RegExp(
          `\\balter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security\\b`,
          'i',
        ).test(statement),
      );

      expect(enableRlsIndex).toBeGreaterThan(createTableIndex);
    }
  });

  it('applies exact learner-read policy cardinality and keeps analytics server-only', () => {
    const statements = sqlStatements(schema());

    for (const table of scopedPublishedTables) {
      const policies = policiesForTable(statements, table);
      expect(policies, `${table} must have exactly one scoped published-read policy`).toHaveLength(1);
      expect(policies[0]).toMatch(/for\s+select\s+to\s+authenticated/i);
      expect(policies[0]).toMatch(/select\s+public\.current_branch_id\(\)/i);
    }

    for (const table of selectOwnTables) {
      const policies = policiesForTable(statements, table);
      expect(policies, `${table} must have exactly one select-own policy`).toHaveLength(1);
      expect(policies[0]).toMatch(/for\s+select\s+to\s+authenticated/i);
      expect(policies[0]).toMatch(
        /using\s*\(\s*\(\s*select\s+auth\.uid\(\)\s*\)\s*=\s*user_id\s*\)/i,
      );
    }

    const skillsPolicies = policiesForTable(statements, 'skills');
    expect(skillsPolicies).toHaveLength(1);
    expect(skillsPolicies[0]).toMatch(/for\s+select\s+to\s+authenticated\s+using\s*\(true\)/i);
    expect(policiesForTable(statements, 'analytics_events')).toHaveLength(0);
  });

  it('exposes only published scoped content through an initplan-cacheable branch lookup', () => {
    const sql = schema();
    const scopedPolicyUsing =
      /using\s*\(\s*status\s*=\s*'published'\s+and\s*\(\s*branch_scope\s*->>\s*'scope'\s*=\s*'global'\s+or\s+branch_scope\s*->\s*'branchIds'\s*\?\s*\(\s*select\s+public\.current_branch_id\(\)\s*\)\s*\)\s*\)/i;

    expect(sql).toMatch(
      /create\s+policy\s+"published resources readable when scoped"\s+on\s+public\.resources\s+for\s+select\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+"published opportunities readable when scoped"\s+on\s+public\.opportunities\s+for\s+select\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+"published projects readable when scoped"\s+on\s+public\.projects\s+for\s+select\s+to\s+authenticated/i,
    );

    const statements = sqlStatements(sql);
    for (const table of scopedPublishedTables) {
      expect(policiesForTable(statements, table)[0]).toMatch(scopedPolicyUsing);
    }
    expect(sql).not.toMatch(/\bcan_access_scoped\b/i);
  });

  it('defines the exact opportunity, project, skill evidence, and lifecycle enums', () => {
    const sql = schema();

    expect(checkedValues(sql, 'resources', 'status')).toEqual(['draft', 'published', 'archived']);
    expect(checkedValues(sql, 'opportunities', 'type')).toEqual([
      'course',
      'workshop',
      'event',
      'research_cohort',
      'competition',
      'hackathon',
      'project',
      'team_opening',
      'mentorship',
      'leadership_role',
      'external_program',
    ]);
    expect(checkedValues(sql, 'opportunities', 'status')).toEqual(['draft', 'published', 'archived']);
    expect(checkedValues(sql, 'projects', 'status')).toEqual([
      'idea',
      'forming',
      'active',
      'completed',
      'showcased',
      'published',
    ]);
    expect(checkedValues(sql, 'project_members', 'role')).toEqual(['owner', 'member', 'mentor']);
    expect(checkedValues(sql, 'skills', 'category')).toEqual([
      'ai',
      'technology',
      'research',
      'entrepreneurship',
      'fintech',
      'core-skills',
      'other',
    ]);
    expect(checkedValues(sql, 'skill_evidence', 'level')).toEqual([
      'exposed',
      'applied',
      'demonstrated',
    ]);
    expect(checkedValues(sql, 'skill_evidence', 'evidence_type')).toEqual([
      'course_completion',
      'exam_passed',
      'assignment_approved',
      'project_contribution',
      'mentor_review',
      'competition_result',
    ]);
  });

  it('uses checked kebab-case primary ids and stores branch scope on every public content table', () => {
    const sql = schema();

    for (const table of ['resources', 'opportunities', 'projects', 'skills']) {
      expect(tableDefinition(sql, table)).toMatch(
        /id\s+text\s+primary\s+key\s+check\s*\(id\s*~\s*'\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$'\)/i,
      );
    }
    for (const table of scopedPublishedTables) {
      const definition = tableDefinition(sql, table);
      expect(definition).toMatch(
        /branch_scope\s+jsonb\s+not\s+null\s+default\s+'\{"scope":"global"\}'::jsonb/i,
      );
      expect(definition).toMatch(
        /check\s*\(\s*branch_scope\s*->>\s*'scope'\s+in\s*\(\s*'global'\s*,\s*'branches'\s*\)\s*\)/i,
      );
    }
  });

  it('defines generated resource search and all requested ecosystem columns', () => {
    const sql = schema();
    const resource = tableDefinition(sql, 'resources');
    const opportunity = tableDefinition(sql, 'opportunities');
    const project = tableDefinition(sql, 'projects');

    expect(resource).toMatch(/search\s+tsvector\s+generated\s+always\s+as\s*\([\s\S]*?title[\s\S]*?summary[\s\S]*?\)\s+stored/i);
    for (const column of [
      'title',
      'organization',
      'type',
      'description',
      'eligibility',
      'recommended_skills',
      'recommended_courses',
      'required_courses',
      'application_url',
      'internal_application',
      'open_at',
      'close_at',
      'start_at',
      'end_at',
      'location',
      'online',
      'branch_scope',
      'status',
      'featured',
    ]) {
      expect(opportunity, `opportunities.${column} is required`).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(project).toMatch(/cover_asset_id\s+text\s+references\s+public\.media_assets\s*\(id\)/i);
    expect(opportunity).toMatch(/check\s*\(\s*close_at\s*>=\s*open_at\s*\)/i);
    expect(opportunity).toMatch(/check\s*\(\s*end_at\s*>=\s*start_at\s*\)/i);
    expect(opportunity).toMatch(/published_at\s+timestamptz/i);
    expect(project).toMatch(/published_at\s+timestamptz/i);
  });

  it('uses a hardened row-independent current-branch helper', () => {
    const sql = schema();

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.current_branch_id\s*\(\s*\)\s+returns\s+text\s+language\s+sql\s+stable\s+security\s+definer\s+set\s+search_path\s*=\s*public,\s*pg_temp/i,
    );
    expect(sql).toMatch(
      /select\s+p\.branch_id\s+from\s+public\.profiles\s+p\s+where\s+p\.id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.current_branch_id\s*\(\s*\)\s+from\s+public/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.current_branch_id\s*\(\s*\)\s+to\s+authenticated/i,
    );
  });

  it('creates the reviewed read-path, foreign-key, search, and analytics indexes', () => {
    const sql = schema();
    const indexNames = [...sql.matchAll(/create\s+index\s+([a-z0-9_]+)\s+on\s+public\./gi)].map(
      (match) => match[1],
    );

    expect(indexNames).toEqual([
      'resources_owner_id',
      'resources_search',
      'resources_published_at',
      'resources_branch_scope',
      'resources_document',
      'opportunities_published_at',
      'opportunities_branch_scope',
      'opportunities_recommended_courses',
      'opportunity_interest_user_id',
      'projects_owner_id',
      'projects_cover_asset_id',
      'projects_published_at',
      'projects_branch_scope',
      'projects_skills',
      'projects_course_ids',
      'project_members_user_id',
      'project_interest_user_id',
      'skill_evidence_skill_id',
      'certificates_course_id',
      'certificates_course_version_id',
      'certificates_pdf_asset_id',
      'xp_events_user_created_at',
      'analytics_events_user_id',
      'analytics_events_name_at',
    ]);
    expect(sql).toMatch(/create\s+index\s+resources_search\s+on\s+public\.resources\s+using\s+gin\s*\(search\)/i);
    for (const table of scopedPublishedTables) {
      expect(sql).toMatch(
        new RegExp(
          `create\\s+index\\s+${table}_published_at\\s+on\\s+public\\.${table}\\s*\\(published_at\\s+desc\\)\\s+where\\s+status\\s*=\\s*'published'`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `create\\s+index\\s+${table}_branch_scope\\s+on\\s+public\\.${table}\\s+using\\s+gin\\s*\\(branch_scope\\s+jsonb_path_ops\\)`,
          'i',
        ),
      );
    }
    expect(sql).toMatch(
      /create\s+index\s+resources_document\s+on\s+public\.resources\s+using\s+gin\s*\(document\s+jsonb_path_ops\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+opportunities_recommended_courses\s+on\s+public\.opportunities\s+using\s+gin\s*\(recommended_courses\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+projects_skills\s+on\s+public\.projects\s+using\s+gin\s*\(skills\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+projects_course_ids\s+on\s+public\.projects\s+using\s+gin\s*\(course_ids\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+xp_events_user_created_at\s+on\s+public\.xp_events\s*\(user_id,\s*created_at\s+desc\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+analytics_events_name_at\s+on\s+public\.analytics_events\s*\(name,\s*at\)/i,
    );
  });

  it('enforces interest keys, evidence and XP idempotency, and certificate uniqueness', () => {
    const sql = schema();

    expect(tableDefinition(sql, 'opportunity_interest')).toMatch(
      /primary\s+key\s*\(opportunity_id,\s*user_id\)/i,
    );
    expect(tableDefinition(sql, 'project_members')).toMatch(/primary\s+key\s*\(project_id,\s*user_id\)/i);
    expect(tableDefinition(sql, 'project_interest')).toMatch(/primary\s+key\s*\(project_id,\s*user_id\)/i);
    expect(tableDefinition(sql, 'skill_evidence')).toMatch(
      /unique\s*\(user_id,\s*skill_id,\s*evidence_type,\s*ref_id\)/i,
    );
    expect(tableDefinition(sql, 'certificates')).toMatch(/serial\s+text\s+not\s+null\s+unique/i);
    expect(tableDefinition(sql, 'certificates')).toMatch(/verification_code\s+text\s+not\s+null\s+unique/i);
    expect(tableDefinition(sql, 'certificates')).toMatch(
      /unique\s*\(user_id,\s*course_version_id\)/i,
    );
    expect(tableDefinition(sql, 'xp_events')).toMatch(
      /unique\s*\(user_id,\s*kind,\s*ref_type,\s*ref_id\)/i,
    );
  });

  it('adds consistent audit timestamps and publication timestamps', () => {
    const sql = schema();

    for (const table of ecosystemTables) {
      const definition = tableDefinition(sql, table);
      expect(definition, `${table}.created_at is required`).toMatch(
        /created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i,
      );
      expect(definition, `${table}.updated_at is required`).toMatch(
        /updated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i,
      );
    }
  });

  it('bounds XP points, models named streak counters, and permits anonymous analytics attribution', () => {
    const sql = schema();

    expect(tableDefinition(sql, 'xp_events')).toMatch(
      /points\s+numeric\s*\(9,\s*2\)\s+not\s+null\s+check\s*\(\s*points\s*>=\s*0\s+and\s+points\s*<=\s*9999999\.99\s*\)/i,
    );
    expect(tableDefinition(sql, 'streaks')).toMatch(
      /current_streak\s+int\s+not\s+null\s+default\s+0\s+check\s*\(current_streak\s*>=\s*0\)/i,
    );
    expect(tableDefinition(sql, 'streaks')).toMatch(
      /longest_streak\s+int\s+not\s+null\s+default\s+0\s+check\s*\(longest_streak\s*>=\s*0\)/i,
    );
    expect(tableDefinition(sql, 'streaks')).toMatch(/check\s*\(current_streak\s*<=\s*longest_streak\)/i);
    expect(tableDefinition(sql, 'streaks')).toMatch(/last_active_date\s+date/i);
    expect(tableDefinition(sql, 'analytics_events')).toMatch(/user_id\s+uuid\s+references\s+public\.profiles\s*\(id\)/i);
    expect(tableDefinition(sql, 'analytics_events')).not.toMatch(/user_id\s+uuid\s+not\s+null/i);
  });

  it('makes every policy explicitly select-only', () => {
    const policyStatements = schema().match(/create\s+policy[\s\S]*?;/gi) ?? [];

    expect(policyStatements).toHaveLength(11);
    for (const policy of policyStatements) {
      expect(policy).toMatch(/\bfor\s+select\b/i);
      expect(policy).not.toMatch(/for\s+(insert|update|delete|all)\b/i);
    }
  });
});

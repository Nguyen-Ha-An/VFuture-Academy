import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0004_learning.sql');
const schema = () => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

const learnerTables = [
  'enrollments',
  'lesson_progress',
  'activity_state',
  'quiz_attempts',
  'exam_attempts',
  'exam_answers',
  'exam_attempt_events',
  'exam_grades',
  'assignment_submissions',
  'submission_files',
  'grades',
  'course_completions',
];

const serverOnlyTables = ['exam_attempts', 'exam_answers', 'exam_attempt_events', 'exam_grades', 'grades'];
const selectOwnTables = learnerTables.filter((table) => !serverOnlyTables.includes(table));

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

describe('0004_learning.sql', () => {
  it('creates every B8 learner table with a primary key and row-level security', () => {
    const sql = schema();

    expect(existsSync(migrationPath)).toBe(true);
    expect(createdTables(sql)).toEqual(learnerTables);
    for (const table of learnerTables) {
      expect(tableDefinition(sql, table)).toMatch(/primary\s+key/i);
      expect(sql).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'),
      );
    }
  });

  it('structurally enables RLS after each learner table and applies exact policy cardinality', () => {
    const sql = schema();
    const statements = sqlStatements(sql);

    for (const table of createdTables(sql)) {
      const createTableIndex = statements.findIndex((statement) =>
        new RegExp(`\\bcreate\\s+table\\s+public\\.${table}\\b`, 'i').test(statement),
      );
      const enableRlsIndex = statements.findIndex((statement) =>
        new RegExp(
          `\\balter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security\\b`,
          'i',
        ).test(statement),
      );
      const policies = policiesForTable(statements, table);

      expect(enableRlsIndex).toBeGreaterThan(createTableIndex);
      if (serverOnlyTables.includes(table)) {
        expect(policies, `${table} must remain server-only`).toHaveLength(0);
      } else {
        expect(policies, `${table} must have exactly one learner read policy`).toHaveLength(1);
        expect(policies[0]).toMatch(/for\s+select\s+to\s+authenticated/i);
        expect(policies[0]).toMatch(
          /using\s*\(\s*\(\s*select\s+auth\.uid\(\)\s*\)\s*=\s*user_id\s*\)/i,
        );
      }
    }
  });

  it('uses initplan-wrapped select-own access only for learner-readable tables', () => {
    const sql = schema();

    for (const table of selectOwnTables) {
      expect(tableDefinition(sql, table)).toMatch(/user_id\s+uuid\s+not\s+null/i);
      expect(sql).toMatch(
        new RegExp(
          `create\\s+policy\\s+"[^"]+"\\s+on\\s+public\\.${table}\\s+for\\s+select\\s+to\\s+authenticated\\s+using\\s*\\(\\s*\\(\\s*select\\s+auth\\.uid\\(\\)\\s*\\)\\s*=\\s*user_id\\s*\\)`,
          'i',
        ),
      );
    }

    const statements = sqlStatements(sql);
    for (const table of serverOnlyTables) {
      expect(policiesForTable(statements, table)).toHaveLength(0);
    }
  });

  it('enforces the exact learner status lifecycles', () => {
    const sql = schema();

    expect(checkedValues(sql, 'enrollments', 'status')).toEqual(['active', 'completed', 'dropped']);
    expect(checkedValues(sql, 'lesson_progress', 'status')).toEqual([
      'not_started',
      'in_progress',
      'completed',
    ]);
    expect(checkedValues(sql, 'exam_attempts', 'status')).toEqual([
      'in_progress',
      'submitted',
      'submitted_late',
      'graded',
      'pending_manual',
      'expired',
    ]);
    expect(checkedValues(sql, 'assignment_submissions', 'status')).toEqual([
      'submitted',
      'in_review',
      'approved',
      'changes_requested',
    ]);
  });

  it('constrains every other enum-like learner column', () => {
    const sql = schema();

    expect(checkedValues(sql, 'exam_attempt_events', 'type')).toEqual([
      'focus_lost',
      'focus_gained',
      'visibility_hidden',
      'paste',
      'fullscreen_exit',
    ]);
    expect(checkedValues(sql, 'exam_grades', 'policy')).toEqual(['best', 'latest', 'first', 'average']);
    expect(checkedValues(sql, 'grades', 'decision')).toEqual(['approved', 'changes_requested']);
  });

  it('links learning records to identity, content, and media records', () => {
    const sql = schema();

    expect(sql).toMatch(/references\s+public\.profiles\s*\(id\)/i);
    expect(sql).toMatch(/references\s+public\.courses\s*\(id\)/i);
    expect(sql).toMatch(/references\s+public\.course_version_items\s*\(version_id,\s*item_id\)/i);
    expect(sql).toMatch(/references\s+public\.media_assets\s*\(id\)/i);
    expect(tableDefinition(sql, 'enrollments')).toMatch(/unique\s*\(user_id,\s*course_id\)/i);
    expect(tableDefinition(sql, 'grades')).toMatch(/submission_id\s+uuid\s+not\s+null\s+unique/i);
    expect(sql).toMatch(
      /alter\s+table\s+public\.course_versions\s+add\s+constraint\s+course_versions_id_course_unique\s+unique\s*\(id,\s*course_id\)/i,
    );
    for (const table of ['enrollments', 'course_completions']) {
      expect(tableDefinition(sql, table)).toMatch(
        /foreign\s+key\s*\(course_version_id,\s*course_id\)\s+references\s+public\.course_versions\s*\(id,\s*course_id\)/i,
      );
    }
    expect(tableDefinition(sql, 'enrollments')).not.toMatch(
      /course_version_id\s+uuid\s+not\s+null\s+references\s+public\.course_versions\s*\(id\)/i,
    );
  });

  it('accepts bounded composite exam question ids produced by the compiler', () => {
    const definition = tableDefinition(schema(), 'exam_answers');

    expect(definition).toMatch(
      /question_id\s+text\s+not\s+null\s+check\s*\(\s*char_length\(question_id\)\s*<=\s*194\s+and\s+question_id\s*~\s*'\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\(\/\[a-z0-9\]\[a-z0-9-\]\{0,63\}\)\{0,2\}\$'\s*\)/i,
    );
  });

  it('bounds all point values with finite numeric precision', () => {
    const sql = schema();
    const boundedPointColumns = [
      ['quiz_attempts', 'points'],
      ['quiz_attempts', 'max_points'],
      ['exam_attempts', 'points'],
      ['exam_attempts', 'max_points'],
      ['exam_answers', 'manual_points'],
      ['grades', 'total_points'],
      ['grades', 'max_points'],
    ];

    for (const [table, column] of boundedPointColumns) {
      expect(tableDefinition(sql, table)).toMatch(
        new RegExp(
          `${column}\\s+numeric\\s*\\(9,\\s*2\\)[^,\\n]*check\\s*\\(\\s*${column}\\s*>=\\s*0\\s+and\\s+${column}\\s*<=\\s*1000000\\s*\\)`,
          'i',
        ),
      );
    }
  });

  it('records late exam attempts and preserves grades when a grader is deleted', () => {
    const sql = schema();

    expect(tableDefinition(sql, 'exam_attempts')).toMatch(/late\s+boolean\s+not\s+null\s+default\s+false/i);
    expect(tableDefinition(sql, 'grades')).toMatch(
      /grader_id\s+uuid\s+references\s+public\.profiles\s*\(id\)\s+on\s+delete\s+set\s+null/i,
    );
  });

  it('allows unanswered exam results and defines atomic start and event admission procedures', () => {
    const sql = schema();
    const answers = tableDefinition(sql, 'exam_answers');

    expect(answers).toMatch(/\banswer\s+jsonb\b/i);
    expect(answers).not.toMatch(/\banswer\s+jsonb\s+not\s+null\b/i);
    expect(sql).toMatch(
      /create\s+unique\s+index\s+exam_attempts_one_active[\s\S]*?where\s+status\s*=\s*'in_progress'/i,
    );
    for (const procedure of ['exam_start_attempt', 'exam_append_attempt_events']) {
      expect(sql).toMatch(new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${procedure}\\b[\\s\\S]*?security\\s+definer`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${procedure}\\b[\\s\\S]*?from\\s+public`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${procedure}\\b[^;]*?from\\s+anon,\\s*authenticated`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${procedure}\\b[\\s\\S]*?to\\s+service_role`,
        'i',
      ));
    }
  });

  it('rejects earned points above the corresponding maximum', () => {
    const sql = schema();

    expect(tableDefinition(sql, 'quiz_attempts')).toMatch(/check\s*\(points\s*<=\s*max_points\)/i);
    expect(tableDefinition(sql, 'exam_attempts')).toMatch(
      /check\s*\(points\s+is\s+null\s+or\s+max_points\s+is\s+null\s+or\s+points\s*<=\s*max_points\)/i,
    );
    expect(tableDefinition(sql, 'grades')).toMatch(/check\s*\(total_points\s*<=\s*max_points\)/i);
  });

  it('creates the required learner lookup and in-progress deadline indexes', () => {
    const sql = schema();
    const indexNames = [...sql.matchAll(/create\s+index\s+([a-z0-9_]+)\s+on\s+public\./gi)].map(
      (match) => match[1],
    );

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'enrollments_user_id',
        'enrollments_course_id',
        'enrollments_course_version_id',
        'enrollments_user_version_active',
        'lesson_progress_user_version',
        'lesson_progress_version_item',
        'activity_state_version_item',
        'quiz_attempts_version_item',
        'exam_attempts_user_version_item_status',
        'exam_attempts_version_item',
        'exam_attempts_in_progress_deadline',
        'exam_grades_version_item',
        'exam_attempt_events_attempt_id',
        'exam_attempt_events_user_id',
        'exam_answers_user_id',
        'exam_answers_graded_by',
        'assignment_submissions_version_item',
        'assignment_submissions_status_submitted_at',
        'submission_files_user_id',
        'submission_files_asset_id',
        'grades_user_id',
        'grades_grader_id',
        'course_completions_course_id',
        'course_completions_course_version_id',
      ]),
    );
    for (const table of [
      'lesson_progress',
      'activity_state',
      'quiz_attempts',
      'exam_attempts',
      'assignment_submissions',
      'exam_grades',
    ]) {
      expect(sql).toMatch(
        new RegExp(`create\\s+index\\s+\\w+\\s+on\\s+public\\.${table}\\s*\\(course_version_id,\\s*item_id\\)`, 'i'),
      );
    }
    for (const table of ['enrollments', 'course_completions']) {
      expect(sql).toMatch(
        new RegExp(`create\\s+index\\s+\\w+\\s+on\\s+public\\.${table}\\s*\\(course_version_id\\)`, 'i'),
      );
    }
    expect(sql).toMatch(
      /create\s+index\s+enrollments_user_version_active\s+on\s+public\.enrollments\s*\(user_id,\s*course_version_id\)\s+where\s+status\s+in\s*\(\s*'active'\s*,\s*'completed'\s*\)/i,
    );
    expect(sql).toMatch(/create\s+index\s+\w+\s+on\s+public\.enrollments\s*\(user_id\)/i);
    expect(sql).toMatch(
      /create\s+index\s+\w+\s+on\s+public\.lesson_progress\s*\(user_id,\s*course_version_id\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+exam_attempts_user_version_item_status\s+on\s+public\.exam_attempts\s*\(user_id,\s*course_version_id,\s*item_id,\s*status\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+\w+\s+on\s+public\.assignment_submissions\s*\(status,\s*submitted_at\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+exam_attempt_events_user_id\s+on\s+public\.exam_attempt_events\s*\(user_id\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+exam_answers_graded_by\s+on\s+public\.exam_answers\s*\(graded_by\)/i,
    );
    expect(sql).toMatch(
      /create\s+index\s+\w+\s+on\s+public\.exam_attempts\s*\(deadline_at\)\s+where\s+status\s*=\s*'in_progress'/i,
    );
  });

  it('defines the hardened course-access function and content read policies', () => {
    const sql = schema();

    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.can_access_course\s*\(p_course_id\s+text\)\s+returns\s+boolean\s+language\s+sql\s+stable\s+security\s+definer\s+set\s+search_path\s*=\s*public,\s*pg_temp/i,
    );
    expect(sql).toMatch(/c\.id\s*=\s*p_course_id\s+and\s+c\.status\s*=\s*'published'/i);
    expect(sql).toMatch(/o\.access\s*->>\s*'scope'\s*=\s*'global'/i);
    expect(sql).toMatch(/o\.access\s*->\s*'branchIds'\s*\?\s*p\.branch_id/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.can_access_course\s*\(text\)\s+from\s+public/i,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.can_access_course\s*\(text\)\s+to\s+authenticated/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+"outline readable when accessible"\s+on\s+public\.course_version_outline\s+for\s+select\s+to\s+authenticated\s+using\s*\(public\.can_access_course\(course_id\)\)/i,
    );
    const renderPolicy = sqlStatements(sql).find((statement) =>
      /create\s+policy\s+"renders readable when enrolled"\s+on\s+public\.course_version_item_renders/i.test(statement),
    ) ?? '';
    expect(renderPolicy).toMatch(/for\s+select\s+to\s+authenticated/i);
    expect(renderPolicy).toMatch(
      /from\s+public\.enrollments\s+e\s+join\s+public\.course_version_items\s+cvi\s+on\s+cvi\.version_id\s*=\s*course_version_item_renders\.version_id\s+and\s+cvi\.item_id\s*=\s*course_version_item_renders\.item_id/i,
    );
    expect(renderPolicy).toMatch(/e\.user_id\s*=\s*\(\s*select\s+auth\.uid\(\)\s*\)/i);
    expect(renderPolicy).toMatch(/e\.course_version_id\s*=\s*course_version_item_renders\.version_id/i);
    expect(renderPolicy).toMatch(/e\.status\s+in\s*\(\s*'active'\s*,\s*'completed'\s*\)/i);
    expect(renderPolicy).toMatch(/cvi\.kind\s*<>\s*'exam'/i);
  });

  it('does not grant insert, update, or delete through a policy', () => {
    const policyStatements = schema().match(/create\s+policy[\s\S]*?;/gi) ?? [];

    for (const policy of policyStatements) {
      expect(policy).not.toMatch(/for\s+(insert|update|delete|all)\b/i);
    }
  });
});

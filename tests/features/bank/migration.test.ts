import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = join(process.cwd(), 'supabase', 'migrations');
const questionBankMigrations = () => readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('_question_bank.sql'));
const migration = () => {
  const [name] = questionBankMigrations();
  return name ? readFileSync(join(migrationsDirectory, name), 'utf8') : '';
};

describe('question bank database procedures', () => {
  it('has exactly one question bank migration', () => {
    expect(questionBankMigrations()).toHaveLength(1);
  });

  it('defines atomic import and version creation procedures restricted to the service role', () => {
    const sql = migration();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_bank_import_bundle/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_bank_create_version/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.studio_bank_publish/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*studio_bank_import_bundle[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute[\s\S]*studio_bank_create_version[\s\S]*to\s+service_role/i);
  });

  it('uses the project-safe search path for every question bank function', () => {
    const searchPaths = [...migration().matchAll(/set\s+search_path\s*=\s*([^\n]+)/gi)]
      .map((match) => match[1].trim());

    expect(searchPaths).toHaveLength(5);
    expect(searchPaths).toEqual(Array(5).fill('public, pg_temp'));
  });

  it('reports colliding imports with a stable database error and identifiers', () => {
    const importBundle = migration().match(/studio_bank_import_bundle[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(importBundle).toMatch(/exception\s+when\s+unique_violation/i);
    expect(importBundle).toMatch(/errcode\s*=\s*'P2001'/i);
    expect(importBundle).toMatch(/message\s*=\s*'BANK_QUESTION_EXISTS'/i);
    expect(importBundle).toMatch(/detail\s*=/i);
  });

  it('preserves the published pointer on edit and makes question versions append-only', () => {
    const sql = migration();
    const createVersion = sql.match(/studio_bank_create_version[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(createVersion).not.toMatch(/status\s*=\s*'draft'/i);
    expect(createVersion).not.toMatch(/current_version_id\s*=/i);
    expect(createVersion).toMatch(/case\s+when\s+bank_questions\.status\s*=\s*'published'\s+then\s+bank_questions\.type\s+else\s+p_type\s+end/i);
    expect(sql).toMatch(/if\s+TG_OP\s*=\s*'DELETE'\s+then\s+return\s+old/i);
    expect(sql).toMatch(/drop\s+trigger\s+if\s+exists\s+bank_question_versions_immutable/i);
    expect(sql).toMatch(/before\s+update\s+or\s+delete\s+on\s+public\.bank_question_versions/i);
    expect(sql).toMatch(/raise\s+exception\s+'bank question versions are immutable'/i);
  });

  it('rejects version creation and publication for archived questions', () => {
    const sql = migration();
    const createVersion = sql.match(/studio_bank_create_version[\s\S]*?\$\$;/i)?.[0] ?? '';
    const publish = sql.match(/studio_bank_publish[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(createVersion).toMatch(/status\s*=\s*'archived'[\s\S]*errcode\s*=\s*'P2002'[\s\S]*BANK_QUESTION_ARCHIVED/i);
    expect(publish).toMatch(/status[\s\S]*'archived'[\s\S]*errcode\s*=\s*'P2002'[\s\S]*BANK_QUESTION_ARCHIVED/i);
  });

  it('publishes the validated expected latest version and audit entry in one transaction', () => {
    const sql = migration();
    const publish = sql.match(/studio_bank_publish[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(publish).toMatch(/for\s+update/i);
    expect(publish).toMatch(/order\s+by\s+bank_version\.version\s+desc/i);
    expect(publish).toMatch(/current_version_id\s*=\s*p_version_id/i);
    expect(publish).toMatch(/type\s*=\s*version_payload\s*->>\s*'type'/i);
    expect(publish).toMatch(/tags\s*=\s*coalesce\s*\(\s*array\s*\(\s*select\s+jsonb_array_elements_text\(version_payload\s*->\s*'tags'\)/i);
    expect(publish).toMatch(/insert\s+into\s+public\.audit_log/i);
    expect(publish).toMatch(/'bank\.publish'/i);
  });

  it('finds exact bank reference strings and returns identifiers without course source payloads', () => {
    const sql = migration();
    const usages = sql.match(/studio_bank_question_usages[\s\S]*?\$\$;/i)?.[0] ?? '';

    expect(usages).toMatch(/jsonb_path_exists[\s\S]*\$ref[\s\S]*bank_ref/i);
    expect(usages).toMatch(/jsonb_path_exists[\s\S]*\$pool[\s\S]*from[\s\S]*bank_ref/i);
    expect(usages).not.toMatch(/'strict\s+\$\.\*\*/i);
    expect(usages).toMatch(/returns\s+table\s*\(\s*version_id\s+uuid,\s*item_id\s+text,\s*course_id\s+text\s*\)/i);
    expect(usages).not.toMatch(/returns\s+table\s*\([^)]*source\s+jsonb/i);
  });
});

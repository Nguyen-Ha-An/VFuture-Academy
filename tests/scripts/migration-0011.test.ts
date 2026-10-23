import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '0011_learning_progress_functions.sql');
const schema = () => (existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '');

describe('0011_learning_progress_functions.sql', () => {
  it('claims course completion and updates enrollment in one hardened transaction function', () => {
    const sql = schema();

    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_complete_course/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*public,\s*pg_temp/i);
    expect(sql).toMatch(/insert\s+into\s+public\.course_completions/i);
    expect(sql).toMatch(/on\s+conflict\s+on\s+constraint\s+course_completions_pkey\s+do\s+nothing/i);
    expect(sql).toMatch(/update\s+public\.enrollments[\s\S]*status\s*=\s*'completed'/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.learner_complete_course/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.learner_complete_course[\s\S]*to\s+service_role/i);
  });

  it('creates a server-only completion-effect outbox in the completion transaction', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+table\s+public\.course_completion_effects/i);
    expect(sql).toMatch(/status\s+text[\s\S]*check\s*\(status\s+in\s*\('pending',\s*'done',\s*'failed'\)\)/i);
    expect(sql).toMatch(/attempts\s+int\s+not\s+null\s+default\s+0/i);
    expect(sql).toMatch(/alter\s+table\s+public\.course_completion_effects\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/if\s+coalesce\(did_transition,\s*false\)[\s\S]*insert\s+into\s+public\.course_completion_effects/i);
    expect(sql).not.toMatch(/create\s+policy[^;]+on\s+public\.course_completion_effects/i);
  });

  it('claims completion effects with an atomic lease before external delivery', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_claim_completion_effect/i);
    expect(sql).toMatch(/for\s+update\s+skip\s+locked/i);
    expect(sql).toMatch(/attempts\s*=\s*effect\.attempts\s*\+\s*1/i);
    expect(sql).toMatch(/locked_until\s*=\s*p_locked_until/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.learner_claim_completion_effect/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.learner_claim_completion_effect[\s\S]*to\s+service_role/i);
  });

  it('dead-letters an expired final-attempt lease instead of leaving it pending forever', () => {
    const sql = schema();

    expect(sql).toMatch(
      /update\s+public\.course_completion_effects\s+as\s+expired[\s\S]*status\s*=\s*'failed'[\s\S]*expired\.attempts\s*>=\s*5[\s\S]*expired\.locked_until\s*<=\s*now\(\)/i,
    );
  });

  it('marks a lesson viewed atomically without downgrading completed progress', () => {
    const sql = schema();

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.learner_mark_viewed/i);
    expect(sql).toMatch(/on\s+conflict\s+on\s+constraint\s+lesson_progress_pkey\s+do\s+update/i);
    expect(sql).toMatch(/when\s+lesson_progress\.status\s*=\s*'completed'\s+then\s+lesson_progress\.status/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.learner_mark_viewed/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.learner_mark_viewed[\s\S]*to\s+service_role/i);
  });
});

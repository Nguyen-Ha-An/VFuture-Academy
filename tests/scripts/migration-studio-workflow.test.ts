import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(process.cwd(), 'supabase', 'migrations');
const filename = readdirSync(migrations).find((entry) => entry.endsWith('_studio_workflow_atomic_publish.sql'));
const sql = filename ? readFileSync(join(migrations, filename), 'utf8') : '';

describe('Studio workflow atomic publication migration', () => {
  it('adds withdrawn without weakening the review status constraint', () => {
    expect(sql).toContain("'withdrawn'");
    expect(sql).toMatch(/check\s*\(status\s+in\s*\([^)]*'pending'[\s\S]*'withdrawn'[\s\S]*'published'/);
  });

  it('serializes requests, withdrawals, approvals, and content mutations on one content lock', () => {
    expect(sql).toContain('create or replace function public.cms_lock_content');
    expect((sql.match(/cms_lock_content(?:_source)?\(/g)?.length ?? 0)).toBeGreaterThanOrEqual(6);
    expect(sql).toContain('CMS_REVIEW_PENDING');
  });

  it('deduplicates requests for an unchanged active snapshot', () => {
    const request = sql.slice(sql.indexOf('create or replace function public.cms_request_review'), sql.indexOf('create or replace function public.cms_withdraw_review'));
    expect(request).toMatch(/status\s+in\s*\('pending',\s*'approved'\)/);
    expect(request).toMatch(/return\s+to_jsonb\(review_row\)/);
  });

  it('publishes approval and audit in one database function', () => {
    const atomic = sql.slice(sql.indexOf('create or replace function public.cms_approve_and_publish'), sql.indexOf('revoke all on function public.cms_approve_and_publish'));
    expect(atomic).toContain('for update');
    expect(atomic).toContain('p_expected_revision');
    expect(atomic).toContain('cms_assert_dependencies');
    expect(atomic).toContain('studio_publish_version_guarded_pre_cms_review');
    expect(atomic).toContain('cms_publish_content');
    expect(atomic).toContain('cms_finalize_publication');
    expect(atomic.indexOf("set status = 'approved'")).toBeGreaterThan(atomic.indexOf('cms_assert_dependencies'));
    expect(atomic.slice(atomic.indexOf("set status = 'approved'")).toLowerCase()).not.toContain('exception when');
  });

  it('keeps published repeats idempotent and legacy approved reviews publishable', () => {
    const atomic = sql.slice(sql.indexOf('create or replace function public.cms_approve_and_publish'), sql.indexOf('revoke all on function public.cms_approve_and_publish'));
    expect(atomic).toMatch(/review\.status\s*=\s*'published'/);
    expect(atomic).toMatch(/review\.status\s+not in\s*\('pending',\s*'approved'\)/);
  });

  it('installs mutation gates for all six content families', () => {
    for (const table of ['course_drafts', 'course_draft_items', 'bank_questions', 'bank_question_versions', 'resources', 'opportunities', 'projects', 'project_members', 'media_assets']) {
      expect(sql).toContain(`on public.${table}`);
    }
  });

  it('locks frozen assets and bank versions through both atomic and legacy publication', () => {
    expect(sql).toContain('create or replace function public.cms_lock_publication_graph');
    expect(sql).toContain("when 'asset' then 'media_asset'");
    expect(sql).toContain("when 'bank_version' then 'bank_question'");
    expect(sql).toContain('order by target.content_type, target.content_id');
    expect(sql).toContain('studio_publish_version_guarded_pre_workflow_lock');
    expect(sql).toContain('studio_bank_publish_pre_workflow_lock');
  });

  it('freezes project covers and dependency ownership', () => {
    expect(sql).toContain("p_source->'record'->>'cover_asset_id'");
    expect(sql).toContain("'ownership_kind', dependency_row.ownership_kind");
    expect(sql).toContain('cms_assert_dependency_ownership');
  });

  it('prevents published projects from being deleted by the authoring workflow', () => {
    expect(sql).toContain('PROJECT_PUBLISHED_DELETE_FORBIDDEN');
    expect(sql).toMatch(/cms_publications where content_type = 'project'/);
  });
});

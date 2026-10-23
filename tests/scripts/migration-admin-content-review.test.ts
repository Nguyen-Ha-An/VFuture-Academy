import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20260906065951_admin_content_review.sql');
const schema = () => existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('admin content review migration', () => {
  it('adds explicit ownership to every supported CMS source', () => {
    const sql = schema();
    for (const table of ['courses', 'bank_questions', 'resources', 'opportunities', 'projects', 'media_assets']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table}[\\s\\S]*ownership_kind`, 'i'));
    }
    expect(sql).toContain("check (ownership_kind in ('central', 'branch'))");
    expect(sql).toContain('owner_branch_id text references public.branches(id)');
  });

  it('stores immutable snapshots, decisions, and one live publication pointer', () => {
    const sql = schema();
    expect(sql).toContain('create table public.cms_content_snapshots');
    expect(sql).toContain('create table public.cms_review_requests');
    expect(sql).toContain('create table public.cms_publications');
    expect(sql).toContain('cms_content_snapshots_immutable');
    expect(sql).toMatch(/primary key \(content_type, content_id\)/i);
  });

  it('keeps all privileged review functions service-role only', () => {
    const sql = schema();
    for (const fn of ['cms_request_review', 'cms_decide_review', 'cms_publish_review', 'cms_assert_publishable']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*to service_role`, 'i'));
    }
  });

  it('exposes an exact Central-only reviewed-versus-published preview', () => {
    const sql = schema();
    expect(sql).toContain('create or replace function public.cms_get_review_preview');
    expect(sql).toMatch(/cms_get_review_preview[\s\S]*authorization_assert_actor\(p_actor_user_id, 'content\.review', 'central'/i);
    expect(sql).toMatch(/'reviewed_source', reviewed_snapshot\.source[\s\S]*'published_snapshot'[\s\S]*'source',published_snapshot\.source/i);
    expect(sql).toMatch(/revoke all on function public\.cms_get_review_preview\(uuid,uuid\)[\s\S]*grant execute[\s\S]*to service_role/i);
  });

  it('rechecks actor authorization and the exact revision during publish', () => {
    const sql = schema();
    expect(sql).toContain("authorization_assert_actor(p_actor_user_id, 'content.publish'");
    expect(sql).toContain("authorization_assert_actor(p_actor_user_id, 'content.review'");
    expect(sql).toMatch(/snapshot\.revision_key is distinct from current_snapshot\s*->>\s*'revision_key'/i);
    expect(sql).toMatch(/snapshot\.checksum is distinct from encode\(digest\(\(current_snapshot\s*->\s*'source'\)::text/i);
  });

  it('pins asset and bank-version dependencies and rejects foreign branch assets', () => {
    const sql = schema();
    expect(sql).toContain("dependency ->> 'kind' = 'bank_version'");
    expect(sql).toContain("dependency ->> 'kind' = 'asset'");
    expect(sql).toContain('CMS_FOREIGN_ASSET');
    expect(sql).toContain('CMS_DEPENDENCY_CHANGED');
  });

  it('detects assignment notebook objects and requires location-matched adapter pins', () => {
    const sql = schema();
    expect(sql).toContain('create or replace function public.cms_notebook_locations');
    expect(sql).toContain("jsonb_typeof(entry.value->'notebook')='object'");
    expect(sql).toMatch(/dependency->>'itemId'=location->>'itemId'[\s\S]*dependency->>'blockId' is not distinct from location->>'blockId'/i);
    expect(sql).toContain('CMS_NOTEBOOK_ADAPTER_REQUIRED');
  });

  it('invalidates pending or approved reviews when a draft revision changes', () => {
    const sql = schema();
    expect(sql).toContain('create or replace function public.cms_invalidate_reviews');
    expect(sql).toMatch(/status = 'stale'[\s\S]*status in \('pending', 'approved'\)/i);
  });
});

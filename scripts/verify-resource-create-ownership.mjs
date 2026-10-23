#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

const runtime = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
const db = new runtime.PGlite();
const creator = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';
const migration = readFileSync(join(repositoryRoot, 'supabase/migrations/20261007101246_resource_create_ownership_guard.sql'), 'utf8');
const assign = (actor, id, kind = 'branch', branch = 'school-a') => db.query(
  'select cms_assign_ownership($1,\'resource\',$2,$3,$4) result', [actor, id, kind, branch],
);
const denied = (operation, message) => assert.rejects(operation, error => error.message.includes(message));
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table media_assets(id text primary key,bucket text,purpose text);
    create table resources(id text primary key, owner_id uuid not null, status text not null,
      ownership_kind text not null default 'central', owner_branch_id text, document jsonb);
    create table cms_review_requests(content_type text, content_id text);
    create table cms_publications(content_type text, content_id text);
    create table audit_log(actor_id uuid,action text,target_type text,target_id text,before jsonb,after jsonb,branch_id text);
    create table actor_permissions(actor_id uuid,kind text,branch text);
    insert into actor_permissions values ('${creator}','branch','school-a'),('${creator}','branch','school-b'),
      ('${creator}','central',null),('${foreign}','branch','school-a');
    create function authorization_has_permission(uuid,text,text,text) returns boolean language sql stable as $$
      select exists(select 1 from actor_permissions where actor_id=$1 and kind=$3 and branch is not distinct from $4)
    $$;
    create function cms_current_snapshot(text,text) returns jsonb language sql stable as $$select '{}'::jsonb$$;
    insert into resources values ('foreign','${foreign}','draft','branch','school-a','{}'),
      ('mine','${creator}','draft','branch','school-a','{}'),
      ('other-scope','${creator}','draft','branch','school-b','{}'),
      ('central','${creator}','draft','central',null,'{}'),
      ('reviewed','${creator}','draft','branch','school-a','{}'),
      ('published','${creator}','draft','branch','school-a','{}'),
      ('live','${creator}','published','branch','school-a','{}');
    insert into cms_review_requests values ('resource','reviewed');
    insert into cms_publications values ('resource','published');
  `);
  // Demonstrate the historical function accepted the foreign creator assignment.
  const baseline = readFileSync(join(repositoryRoot, 'supabase/migrations/20260907090001_media_authoring_guards.sql'), 'utf8');
  await db.exec(baseline.slice(baseline.indexOf('create or replace function public.cms_assign_ownership(')));
  await assign(creator, 'foreign', 'branch', 'school-b');
  assert.equal((await db.query("select owner_branch_id from resources where id='foreign'")).rows[0].owner_branch_id, 'school-b');
  await db.exec("update resources set owner_branch_id='school-a' where id='foreign'; truncate audit_log");
  await db.exec(migration);

  await denied(() => assign(creator, 'foreign'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(creator, 'other-scope'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(creator, 'central'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(foreign, 'mine'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(creator, 'missing'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(creator, 'live'), 'CMS_OWNERSHIP_ASSIGNMENT_DENIED');
  await denied(() => assign(foreign, 'mine', 'branch', 'school-b'), 'Permission denied');
  await denied(() => assign(creator, 'reviewed'), 'CMS_OWNERSHIP_LOCKED');
  await denied(() => assign(creator, 'published'), 'CMS_OWNERSHIP_LOCKED');
  await denied(() => assign(creator, 'mine', null, null), 'CMS_OWNERSHIP_INVALID');
  await assign(creator, 'mine');
  await assign(creator, 'mine');
  await assign(creator, 'central', 'central', null);
  // First create has its workspace immediately, even if the process exits before acknowledgment.
  await db.query('insert into resources values ($1,$2,\'draft\',\'branch\',\'school-a\',\'{}\')', ['first-create', creator]);
  await assign(creator, 'first-create');
  const owners = await db.query('select id,owner_id,ownership_kind,owner_branch_id from resources order by id');
  assert.equal(owners.rows.find(row => row.id === 'foreign').owner_id, foreign);
  assert.equal(owners.rows.find(row => row.id === 'other-scope').owner_branch_id, 'school-b');
  assert.equal((await db.query('select count(*)::int n from audit_log')).rows[0].n, 4);
  const definition = (await db.query("select pg_get_functiondef('cms_assign_ownership(uuid,text,text,text,text)'::regprocedure) definition")).rows[0].definition;
  assert.match(definition, /where id=p_content_id for update/i);
  assert.ok(definition.indexOf('for update') < definition.indexOf('if exists (select 1 from public.cms_review_requests'));
  const grants = await db.query("select has_function_privilege('authenticated','cms_assign_ownership(uuid,text,text,text,text)','execute') authenticated, has_function_privilege('anon','cms_assign_ownership(uuid,text,text,text,text)','execute') anon, has_function_privilege('service_role','cms_assign_ownership(uuid,text,text,text,text)','execute') service");
  assert.deepEqual(grants.rows[0], { authenticated: false, anon: false, service: true });
  console.log('PASS: baseline takeover reproduced; creator/workspace guard, first create, same-scope retry, review/publication locks, row-lock ordering and execution grants verified in PostgreSQL.');
} finally {
  await db.close();
  if (runtime.temporaryPrefix) rmSync(runtime.temporaryPrefix, { recursive: true, force: true });
}

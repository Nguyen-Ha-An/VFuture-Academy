#!/usr/bin/env node
// Execute the complete checked-in schema, including legacy views/RPCs, in disposable PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

export async function createFullAdminDatabase(PGlite, {until,seedLegacyFixtures=false}={}) {
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
    alter table storage.objects enable row level security;
    -- Core PostgreSQL SHA-256 backs the pgcrypto digest signature used by CMS.
    create function public.digest(value text,algorithm text) returns bytea language plpgsql immutable as $$
    begin if algorithm<>'sha256' then raise exception 'Unsupported test algorithm'; end if; return sha256(convert_to(value,'UTF8')); end $$;
  `);
  const files=readdirSync(resolve(repositoryRoot,'supabase/migrations')).filter(file=>file.endsWith('.sql')).sort();
  let seeded=false;
  for(const file of files) {
    if(until&&file>until)break;
    if(seedLegacyFixtures&&!seeded&&file.startsWith('2026')) {
      await db.exec(`
        insert into auth.users(id,email) values ('ffffffff-0000-4000-8000-000000000001','migration-admin@example.test'),('ffffffff-0000-4000-8000-000000000002','migration-learner@example.test');
        insert into public.user_roles(user_id,role,branch_id) values('ffffffff-0000-4000-8000-000000000001','admin',null);
        update public.profiles set branch_id='ans' where id='ffffffff-0000-4000-8000-000000000002';
        insert into public.courses(id,owner_id,status) values('migration-access-fixture','ffffffff-0000-4000-8000-000000000001','published');
        insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by)
          values('ffffffff-0000-4000-8000-000000000010','migration-access-fixture',1,'{}','fixture','{}','ffffffff-0000-4000-8000-000000000001');
        update public.courses set current_version_id='ffffffff-0000-4000-8000-000000000010' where id='migration-access-fixture';
        insert into public.enrollments(user_id,course_id,course_version_id) values('ffffffff-0000-4000-8000-000000000002','migration-access-fixture','ffffffff-0000-4000-8000-000000000010');
      `);
      seeded=true;
    }
    const sql=readFileSync(resolve(repositoryRoot,'supabase/migrations',file),'utf8').replace('create extension if not exists pgcrypto;','');
    try { await db.exec(sql); }
    catch(error){ await db.close(); throw new Error(`Migration failed: ${file}`,{cause:error}); }
  }
  return db;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const loaded=await loadPGlite(process.argv[2]??process.env.PGLITE_MODULE_PATH);
  try {
    const db=await createFullAdminDatabase(loaded.PGlite,{seedLegacyFixtures:true});
    await db.exec(`grant select on public.enrollments to authenticated;grant usage on schema auth to authenticated;
      set request.jwt.claim.sub='ffffffff-0000-4000-8000-000000000002';set role authenticated;`);
    assert.equal((await db.query('select count(*)::integer n from public.enrollments')).rows[0].n,1);
    await db.exec(`reset role;update public.user_accounts set status='suspended' where user_id='ffffffff-0000-4000-8000-000000000002';set role authenticated;`);
    assert.equal((await db.query('select count(*)::integer n from public.enrollments')).rows[0].n,0);
    await db.exec('reset role');
    await db.close();
    console.log('Complete Admin migration chain passed in disposable PostgreSQL.');
  } finally {if(loaded.temporaryPrefix)rmSync(loaded.temporaryPrefix,{recursive:true,force:true});}
}

import { PGlite, pgcrypto } from '../lib/studio-sql-runtime.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
`);
for(const name of (await fs.readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
 if(name==='20260907085959_cms_pgcrypto_schema.sql') {
   await db.exec('create schema if not exists extensions; alter extension pgcrypto set schema extensions;');
 }
 if(name==='20260907090000_media_asset_purpose.sql')await db.exec(`
 insert into auth.users(id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','assets@example.test');
 insert into public.role_definitions(id,name,scope_kind,permissions) values ('asset_tester','Asset tester','central',array['content.read','media.upload','content.create','content.review']);
 insert into public.role_assignments(user_id,role_definition_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','asset_tester');
 insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes) values
 ('asset-avatar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar/old/avatar.png','image/png',12),
 ('asset-content','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media','media/asset-content/diagram.png','image/png',12),
 ('asset-submission','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','submissions','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/work.txt','text/plain',12);
 `);
 try {await db.exec(await fs.readFile('supabase/migrations/'+name,'utf8')); console.log('PASS',name)}catch(e){console.error('FAIL',name,e.message);await db.close();process.exit(1)}
 if(name==='20260926090000_media_project_cover_purpose.sql')await db.exec(`
 insert into public.media_assets(id,owner_id,bucket,path,purpose,mime,size_bytes) values
 ('asset-project-cover','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/project-cover/asset-project-cover/cover.png','project_cover','image/png',12);
 `);
}
console.log('ALL MIGRATIONS EXECUTED');
assert.deepEqual((await db.query('select id,purpose from public.media_assets order by id')).rows,[{id:'asset-avatar',purpose:'avatar'},{id:'asset-content',purpose:'content'},{id:'asset-project-cover',purpose:'project_cover'},{id:'asset-submission',purpose:'submission'}]);
await assert.rejects(()=>db.query("insert into public.media_assets(id,owner_id,bucket,path,purpose,mime,size_bytes) values ('asset-unknown','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media','x/unknown.png','cover','image/png',12)"),/media_assets_purpose_check/);
const inventory=(await db.query("select public.cms_list_content('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','central',null) as data")).rows[0].data;
assert.deepEqual(inventory.filter(row=>row.content_type==='media_asset').map(row=>row.content_id),['asset-content']);
for(const id of ['asset-avatar','asset-submission','asset-project-cover']){
 await assert.rejects(()=>db.query("select public.cms_assert_content_access('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media_asset',$1,'content.edit')",[id]),/Permission denied/);
 await assert.rejects(()=>db.query("select public.cms_assign_ownership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','media_asset',$1,'central',null)",[id]),/CMS_OWNERSHIP_ASSIGNMENT_DENIED/);
 await assert.rejects(()=>db.query("select public.cms_snapshot_dependencies($1::jsonb,'central',null)",[JSON.stringify({assetId:id})]),/CMS_ASSET_NOT_FOUND/);
}
const history=(await db.query("select public.cms_current_snapshot('media_asset','asset-avatar') as data")).rows[0].data;
assert.equal(history.source.asset.path,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/avatar/old/avatar.png');
console.log('ASSET BACKFILL, INVENTORY, ACCESS, OWNERSHIP, DEPENDENCY AND HISTORY ASSERTIONS PASSED');
await db.close();

#!/usr/bin/env node
// Destructive ONLY to an explicitly empty, dedicated loopback *_media_delete_test
// database/cluster. Never accepts an Azure or other remote connection URL.
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { buildAzureSchema } from './schema.mjs';
const url=new URL(process.env.ACADEMY_NATIVE_TEST_DATABASE_URL??'');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_media_delete_test'))throw new Error('Use a fresh dedicated loopback *_media_delete_test database');
const admin=new Client({connectionString:url.toString()});
const writer=new Client({connectionString:url.toString()});
const deleter=new Client({connectionString:url.toString()});
const actor='11111111-1111-4111-8111-111111111111';
let writerConnected=false;let deleterConnected=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForLock(pid){
  for(let i=0;i<100;i++){
    if((await admin.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==='Lock')return;
    await pause(25);
  }
  throw new Error('Expected native lock wait was not observed');
}
async function outcome(promise){try{return {value:await promise};}catch(error){return {error};}}
try{
  await admin.connect();
  const occupied=await admin.query("select (select count(*) from pg_tables where schemaname in ('public','academy_private','academy_identity'))+(select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','academy_authenticator')) n");
  if(Number(occupied.rows[0].n)!==0)throw new Error('Native fixture requires an empty dedicated PostgreSQL cluster');
  await admin.query(buildAzureSchema().sql);
  await admin.query("insert into academy_identity.users(id,email) values($1,'native-admin@example.test')",[actor]);
  await admin.query("insert into public.role_assignments(user_id,role_definition_id) values($1,'central_admin')",[actor]);
  await admin.query("insert into public.courses(id,owner_id) values('native-course-a',$1),('native-course-b',$1),('native-course-c',$1)",[actor]);
  await admin.query("insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes,purpose) values('asset_nativea',$1,'media','native-a.png','image/png',12,'content'),('asset_nativeb',$1,'media','native-b.png','image/png',12,'content'),('asset_nativec',$1,'media','native-c.png','image/png',12,'content')",[actor]);
  await writer.connect();writerConnected=true;await deleter.connect();deleterConnected=true;
  const pid=(await deleter.query('select pg_backend_pid() pid')).rows[0].pid;
  // A reference committed while deletion waited must be seen after the wait.
  await writer.query('begin');
  await writer.query("insert into public.course_drafts(course_id,manifest) values('native-course-a','{\"assetId\":\"asset_nativea\"}')");
  await deleter.query('begin');
  const pending=outcome(deleter.query("select public.academy_media_delete_begin($1,'asset_nativea','central',null)",[actor]));
  await waitForLock(pid);await writer.query('commit');
  const blocked=await pending;assert.match(blocked.error?.message??'',/MEDIA_IN_USE/);await deleter.query('rollback');
  // After a committed pending tombstone, a new reference can never race removal.
  await deleter.query("select public.academy_media_delete_begin($1,'asset_nativeb','central',null)",[actor]);
  await assert.rejects(writer.query("insert into public.course_drafts(course_id,manifest) values('native-course-b','{\"assetId\":\"asset_nativeb\"}')"),/MEDIA_PROTECTED/);
  // Even an old REPEATABLE READ snapshot must abort rather than miss a new ref.
  await deleter.query('begin isolation level repeatable read');
  await deleter.query("select count(*) from public.media_assets");
  await writer.query("insert into public.course_drafts(course_id,manifest) values('native-course-c','{\"assetId\":\"asset_nativec\"}')");
  const stale=await outcome(deleter.query("select public.academy_media_delete_begin($1,'asset_nativec','central',null)",[actor]));
  assert.equal(stale.error?.code,'40001');await deleter.query('rollback');
  console.log('Native media reference/delete ordering passed, including REPEATABLE READ fencing. Dedicated test database remains disposable.');
}finally{
  await Promise.allSettled([...(writerConnected?[writer.query('rollback')]:[]),...(deleterConnected?[deleter.query('rollback')]:[])]);
  await Promise.allSettled([writer.end(),deleter.end(),admin.end()]);
}

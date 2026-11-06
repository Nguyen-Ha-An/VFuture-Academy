#!/usr/bin/env node
// Disposable native PostgreSQL17 only. This is local SQL compatibility evidence,
// not committed-source provenance, hosted readiness, or deployment authorization.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverStudioPostgresBinaries, createStudioFixtureClient } from '../lib/studio-postgres-fixture.mjs';
import { buildAzureSchema } from './schema.mjs';
import { createForwardExecutor } from './forward.mjs';
import { createForward53Executor } from './forward-53.mjs';
import { createForward54Executor } from './forward-54.mjs';

const explicit=process.env.STUDIO_POSTGRES_BIN;
if(!explicit || !['initdb','pg_ctl','postgres'].every(name=>existsSync(join(explicit,name))))throw new Error('An existing explicit local PostgreSQL binary directory is required');
const found=discoverStudioPostgresBinaries();
if(found.temporaryRuntime || realpathSync(found.bin)!==realpathSync(explicit))throw new Error('Automatic runtime installation is forbidden');
const target={AZURE_TARGET_HOST:'fixture.postgres.database.azure.com',AZURE_DATABASE_URL:'postgres://academy_admin:fixture@fixture.postgres.database.azure.com/academy?sslmode=verify-full'};
const imported='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const sha='a'.repeat(40),source={sourceClean:true,sourceCommit:'b'.repeat(40),sourceTree:'c'.repeat(40)};
const v1=buildAzureSchema({through:'20261105020000_teaching_permissions_activation.sql'});
const baseline=v1.steps.filter(step=>!/^supabase\/migrations\/20261105/.test(step.id));
const root=mkdtempSync('/tmp/academy-forward54-pg.'),data=join(root,'data'),socket=join(root,'socket');
mkdirSync(socket,{mode:0o700});
const env={PATH:process.env.PATH,LC_ALL:'C',LANG:'C',DYLD_LIBRARY_PATH:resolve(explicit,'../lib')};
const run=(name,args)=>execFileSync(join(found.bin,name),args,{env,stdio:'pipe'});
let started=false;const clients=[];
try{
  run('initdb',['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-F -c listen_addresses='' -k ${socket}`,'-w','start']);started=true;
  const control=createStudioFixtureClient({host:socket,user:'postgres',database:'postgres'});await control.connect();clients.push(control);
  await control.query('create role academy_admin login superuser');await control.query('create database academy owner academy_admin');
  const db=createStudioFixtureClient({host:socket,user:'academy_admin',database:'academy'});await db.connect();clients.push(db);
  const environment=(await db.query("select current_database() as database,inet_server_addr() is null as socket_only,current_setting('listen_addresses') as listeners,current_setting('server_version_num') as version")).rows[0];
  assert.equal(environment.database,'academy');assert.equal(environment.socket_only,true);assert.equal(environment.listeners,'');assert.match(environment.version,/^17\d{4}$/);
  await db.query(baseline.map(step=>step.sql).join('\n\n'));
  await db.query("update academy_private.migration_state set state='imported',schema_sha256=$1,imported_at=now() where singleton",[imported]);
  const initial=createForwardExecutor({db,target});
  await initial.apply('schema',await initial.plan('schema'));
  await initial.apply('activate',await initial.plan('activate'),{verified:true,reviewedSha:sha,verifiedSha:sha});
  const assessment=createForward53Executor({db,target,expectedActivationSha:sha,source});
  await assessment.apply(await assessment.plan());
  const user='98000000-0000-4000-8000-000000000021';
  const noHandle='98000000-0000-4000-8000-000000000022';
  await db.query("insert into academy_identity.users(id,email) values($1,'forward54-fixture@example.test'),($2,'nohandle@example.test')",[user,noHandle]);
  await db.query("update public.profiles set handle='retained-old-link',display_name='Existing Name',branch_id='ans' where id=$1",[user]);
  const old=(await db.query('select to_jsonb(p) row from public.profiles p where id=$1',[user])).rows[0].row;
  const prior=(await db.query('select * from academy_private.assessment_forward_receipt')).rows;
  const roles=(await db.query('select id,permissions from public.role_definitions order by id')).rows;
  const executor=createForward54Executor({db,target,expectedActivationSha:sha,source});
  const plan=await executor.plan();assert.equal(plan.action,'apply');assert.match(plan.identitySha256,/^[a-f0-9]{64}$/);
  const failed=createForward54Executor({db:{query:(sql,params)=>db.query(sql.includes('create table public.profile_handle_aliases')?'select 1/0':sql,params)},target,expectedActivationSha:sha,source});
  await assert.rejects(failed.apply(plan),error=>error.code==='22012');
  assert.equal((await db.query("select to_regclass('academy_private.handle_forward_receipt') is null absent")).rows[0].absent,true);
  assert.deepEqual((await db.query('select to_jsonb(p) row from public.profiles p where id=$1',[user])).rows[0].row,old);
  await assert.rejects(executor.apply({...plan,identitySha256:'0'.repeat(64)}));
  assert.equal((await executor.apply(plan)).action,'applied');
  const now=(await db.query('select to_jsonb(p) row from public.profiles p where id=$1',[user])).rows[0].row;
  assert.equal(now.handle,'STU-retained-old-link');assert.equal(now.handle_category,'STU');
  const {handle:_oldHandle,...oldRetained}=old;const {handle:_newHandle,handle_category:_category,...newRetained}=now;
  assert.deepEqual(oldRetained,newRetained);
  assert.equal((await db.query('select user_id from public.profile_handle_aliases where handle=$1',['retained-old-link'])).rows[0].user_id,user);
  assert.deepEqual((await db.query('select * from academy_private.assessment_forward_receipt')).rows,prior);
  assert.deepEqual((await db.query('select id,permissions from public.role_definitions order by id')).rows,roles);
  const rival=createStudioFixtureClient({host:socket,user:'academy_admin',database:'academy'});await rival.connect();clients.push(rival);
  const change='select * from public.profile_change_handle($1,$2,now())';
  const raced=await Promise.all([db.query(change,[user,'STU-race-target']),rival.query(change,[noHandle,'STU-race-target'])]);
  assert.deepEqual(raced.map(result=>result.rows[0].outcome).sort(),['CHANGED','HANDLE_TAKEN']);
  assert.equal((await rival.query(change,[noHandle,'STU-retained-old-link'])).rows[0].outcome,'HANDLE_TAKEN','A historical canonical URL remains reserved');
  assert.equal((await executor.apply(await executor.plan())).action,'noop');
  assert.equal((await db.query('select schema_sha256 from academy_private.migration_state where singleton')).rows[0].schema_sha256,imported);
  console.log('LOCAL ONLY: fixed54 real PostgreSQL rollback, stale-plan rejection, profile UUID/fields and aliases, predecessor/role preservation, service grants, concurrent collision/alias reservation and idempotent replay passed.');
}finally{
  await Promise.all(clients.map(client=>client.end().catch(()=>undefined)));
  if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  rmSync(root,{recursive:true,force:true});
}

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
import { createForward55Executor } from './forward-55.mjs';
import {teacherCutoverInventory} from './forward-55-inventory.mjs';
import { FORWARD55_FILES } from './forward-55-artifact.mjs';
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
const root=mkdtempSync('/tmp/academy-forward55-pg.'),data=join(root,'data'),socket=join(root,'socket');
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
  // Freeze the completed54 receipt before55 adds new persisted role permissions.
  const predecessor=(await db.query('select filename,source_sha256,azure_sha256,identity_sha256,source_commit,source_tree from academy_private.handle_forward_receipt where singleton')).rows[0];
  const previous=(await db.query('select * from academy_private.handle_forward_receipt')).rows;
  const identityIssuer='https://identity.fixture.test',oldToken='1'.repeat(64),newToken='2'.repeat(64);
  await db.query('insert into academy_identity.mappings(issuer,subject,user_id) values($1,$2,$2)',[identityIssuer,user]);
  await db.query("select public.academy_identity_create_session($1,$2,$3,$2,'subject',now()+interval '23 hours',now()+interval '1 hour','fixture-encrypted','external-id')",[oldToken,user,identityIssuer]);
  const existingSession=(await db.query('select to_jsonb(s) value from academy_identity.sessions s where token_hash=$1',[oldToken])).rows[0].value;
  await assert.rejects(db.query("select public.academy_identity_create_session($1,$2,$3,$2,'subject',now()+interval '30 days',now()+interval '1 hour','fixture-encrypted','external-id')",[newToken,user,identityIssuer]),error=>error.code==='P0001');
  const centralAdmin='98000000-0000-4000-8000-000000000031',schoolAdmin='98000000-0000-4000-8000-000000000032';
  const ordinaryTeacher='98000000-0000-4000-8000-000000000033',globalTeacher='98000000-0000-4000-8000-000000000034';
  const readOnly='98000000-0000-4000-8000-000000000035',suspended='98000000-0000-4000-8000-000000000036';
  const inventoryVersion='98000000-0000-4000-8000-000000000037';
  const mixedTeacher='98000000-0000-4000-8000-000000000038',globalReporter='98000000-0000-4000-8000-000000000039';
  assert.deepEqual(await teacherCutoverInventory(db),{ordinaryActorCount:0,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:false});
  for(const [index,id] of [centralAdmin,schoolAdmin,ordinaryTeacher,globalTeacher,readOnly,suspended,mixedTeacher,globalReporter].entries()){
   await db.query("insert into academy_identity.users(id,email) values($1,$2)",[id,`inventory-${index}@example.test`]);
   await db.query("select public.profile_initialize($1,'Private Fixture Name')",[id]);
  }
  await db.query("insert into public.role_definitions(id,name,scope_kind,permissions) values('cutover_readonly','Inventory readonly','branch',array['learning.read']),('cutover_global_report','Inventory global report','central',array['report.global.read'])");
  await db.query("insert into public.branch_memberships(user_id,branch_id) values($1,'ans'),($2,'ans'),($3,'ans'),($4,'ans')",[schoolAdmin,ordinaryTeacher,readOnly,suspended]);
  await db.query("insert into public.role_assignments(user_id,role_definition_id,branch_id) values($1,'central_admin',null),($2,'school_admin','ans'),($3,'teacher','ans'),($4,'legacy_instructor_central',null),($5,'cutover_readonly','ans'),($6,'teacher','ans')",[centralAdmin,schoolAdmin,ordinaryTeacher,globalTeacher,readOnly,suspended]);
  await db.query("insert into public.branch_memberships(user_id,branch_id) values($1,'ans'),($1,'vinsmc'),($2,'ans'),($2,'vinsmc')",[mixedTeacher,globalReporter]);
  await db.query("insert into public.role_assignments(user_id,role_definition_id,branch_id) values($1,'school_admin','ans'),($1,'teacher','vinsmc'),($2,'school_admin','ans'),($2,'cutover_global_report',null)",[mixedTeacher,globalReporter]);
  await db.query("update public.user_accounts set status='suspended',suspended_at=now() where user_id=$1",[suspended]);
  await db.query("insert into public.courses(id,owner_id,status) values('cutover-inventory-fixture',$1,'published')",[user]);
  await db.query("insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,'cutover-inventory-fixture',1,'{}','fixture','{}',$2)",[inventoryVersion,user]);
  await db.query("insert into public.enrollments(user_id,course_id,course_version_id) values($1,'cutover-inventory-fixture',$2)",[user,inventoryVersion]);
  await db.query("update public.profiles set branch_id='vinsmc' where id=$1",[noHandle]);
  await db.query("insert into public.enrollments(user_id,course_id,course_version_id) values($1,'cutover-inventory-fixture',$2)",[noHandle,inventoryVersion]);
  const emptyInventory={ordinaryActorCount:0,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:false};
  async function assertMixedInventoryCases(){
   const ordinaryActors=[ordinaryTeacher,globalTeacher,readOnly,mixedTeacher,globalReporter];
   await db.query("update public.user_accounts set status='suspended',suspended_at=now() where user_id=any($1::uuid[])",[ordinaryActors]);
   assert.deepEqual(await teacherCutoverInventory(db),emptyInventory,'Pure active central/school admins require no ordinary assignments');
   await db.query("update public.user_accounts set status='active',suspended_at=null where user_id=$1",[mixedTeacher]);
   assert.deepEqual(await teacherCutoverInventory(db),{ordinaryActorCount:1,eligibleBranchTeacherPairCount:1,activeEnrollmentCourseBranchPairCount:1,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:true},'ANS school admin remains ordinary teacher at VinSMC; ANS enrollment is excluded');
   await db.query("update public.user_accounts set status='suspended',suspended_at=now() where user_id=$1",[mixedTeacher]);
   await db.query("update public.user_accounts set status='active',suspended_at=null where user_id=$1",[globalReporter]);
   assert.deepEqual(await teacherCutoverInventory(db),{ordinaryActorCount:1,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:1,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:true},'Global report plus ANS admin still needs non-ANS assignments; ANS membership is not an eligible ordinary pair');
   await db.query("update public.user_accounts set status='active',suspended_at=null where user_id=any($1::uuid[])",[ordinaryActors]);
  }
  await assertMixedInventoryCases();
  const expectedInventory={ordinaryActorCount:5,eligibleBranchTeacherPairCount:2,activeEnrollmentCourseBranchPairCount:2,ordinaryGlobalActorWithoutMembershipCount:1,requiresInitialAssignments:true};
  assert.deepEqual(await teacherCutoverInventory(db),expectedInventory,'Pre55 simulates scope-all admin exclusions without new functions/tables');
  const retained=(await db.query('select id,permissions,built_in,scope_kind from public.role_definitions order by id collate "C"')).rows;
  const options={db,target,expectedActivationSha:sha,expectedPredecessor:predecessor,source};
  assert.throws(()=>createForward55Executor({...options,source:{sourceClean:false,sourceCommit:null,sourceTree:null}}));
  await assert.rejects(createForward55Executor({...options,expectedPredecessor:{...predecessor,source_commit:'d'.repeat(40)}}).plan());
  const teaching=createForward55Executor(options);
  await db.query('create function public.exam_assert_teaching_scope(uuid,text,uuid) returns void language plpgsql as $$begin return; end$$');
  await assert.rejects(teaching.plan());
  await db.query('drop function public.exam_assert_teaching_scope(uuid,text,uuid)');
  const reviewed=await teaching.plan();assert.equal(reviewed.action,'apply');
  assert.deepEqual(reviewed.migrations.map(row=>row.file),FORWARD55_FILES);
  assert.deepEqual(reviewed.teacherCutoverInventory,expectedInventory);
  assert.equal(JSON.stringify(reviewed.teacherCutoverInventory).includes('Private Fixture Name'),false);
  await db.query("update public.branch_memberships set status='suspended' where user_id=$1",[ordinaryTeacher]);
  await assert.rejects(teaching.apply(reviewed),'Inventory changes make the reviewed plan stale');
  await db.query("update public.branch_memberships set status='active' where user_id=$1",[ordinaryTeacher]);
  // Fail the last step: every preceding DDL, permission change and receipt must roll back.
  const broken=createForward55Executor({...options,db:{query:(sql,params)=>db.query(sql.startsWith('-- source: '+FORWARD55_FILES.at(-1))?'select 1/0':sql,params)}});
  await assert.rejects(broken.apply(reviewed),error=>error.code==='22012');
  const brokenIdentity=createForward55Executor({...options,db:{query:(sql,params)=>db.query(sql.startsWith('-- Apply after the transformed Academy migrations.')?'select 1/0':sql,params)}});
  await assert.rejects(brokenIdentity.apply(reviewed),error=>error.code==='22012');
  assert.equal((await db.query("select to_regclass('public.course_teaching_assignments') is null and to_regclass('academy_private.teaching_forward_receipt') is null as absent")).rows[0].absent,true);
  assert.deepEqual((await db.query('select id,permissions,built_in,scope_kind from public.role_definitions order by id collate "C"')).rows,retained);
  assert.deepEqual((await db.query('select * from academy_private.handle_forward_receipt')).rows,previous);
  await assert.rejects(teaching.apply({...reviewed,priorReceiptDigest:'0'.repeat(64)}));
  await assert.rejects(teaching.apply({...reviewed,migrations:reviewed.migrations.slice(0,3)}));
  await assert.rejects(createForward55Executor({...options,verifySource:()=>({...source,sourceTree:'d'.repeat(40)})}).apply(reviewed));
  assert.equal((await teaching.apply(reviewed)).action,'applied');
  assert.deepEqual((await db.query('select to_jsonb(s) value from academy_identity.sessions s where token_hash=$1',[oldToken])).rows[0].value,existingSession);
  await db.query('set role service_role');
  try{
   await db.query("select public.academy_identity_create_session($1,$2,$3,$2,'subject',now()+interval '30 days',now()+interval '1 hour','fixture-encrypted','external-id')",[newToken,user,identityIssuer]);
   await assert.rejects(db.query("select public.academy_identity_create_session($1,$2,$3,$2,'subject',now()+interval '30 days 2 minutes',now()+interval '1 hour','fixture-encrypted','external-id')",['3'.repeat(64),user,identityIssuer]),error=>error.code==='P0001');
  }finally{await db.query('reset role');}
  assert.equal((await db.query('select count(*)::integer n from academy_identity.sessions')).rows[0].n,2);
  const after=(await db.query('select id,permissions,built_in,scope_kind from public.role_definitions order by id collate "C"')).rows;
  assert.deepEqual(after.map(row=>({...row,permissions:row.permissions.filter(permission=>!['teaching.assignment.manage','teaching.scope.all'].includes(permission))})),retained);
  for(const role of after){
   const added=role.permissions.filter(permission=>['teaching.assignment.manage','teaching.scope.all'].includes(permission));
   assert.deepEqual(added,['central_admin','school_admin'].includes(role.id)?['teaching.assignment.manage','teaching.scope.all']:[]);
  }
  assert.deepEqual((await db.query('select * from academy_private.handle_forward_receipt')).rows,previous);
  assert.deepEqual((await db.query('select * from academy_private.assessment_forward_receipt')).rows,prior);
  assert.equal((await db.query('select count(*)::integer n from public.course_teaching_assignments')).rows[0].n,0);
  // Existing assignments never remove ordinary actors from cutover inventory.
  await db.query("insert into public.course_teaching_groups(course_id,branch_id) values('cutover-inventory-fixture','ans')");
  await db.query("insert into public.course_teaching_assignments(course_id,branch_id,user_id,role) values('cutover-inventory-fixture','ans',$1,'primary')",[ordinaryTeacher]);
  await assertMixedInventoryCases();
  assert.deepEqual(await teacherCutoverInventory(db),expectedInventory);
  const replay=await teaching.plan();assert.equal(replay.action,'noop');assert.deepEqual(replay.teacherCutoverInventory,expectedInventory);assert.equal((await teaching.apply(replay)).action,'noop');
  assert.equal((await db.query('select count(*)::integer n from academy_private.teaching_forward_receipt')).rows[0].n,1);
  await db.query("alter table public.course_teaching_assignments disable row level security");
  await assert.rejects(teaching.plan());
  await db.query("alter table public.course_teaching_assignments enable row level security");
  assert.equal((await teaching.plan()).action,'noop');
  console.log('LOCAL ONLY: PostgreSQL17 exact post54 -> explicit five-file teacher release, last-step atomic rollback, empty initial assignments, stale source/plan rejection, unchanged predecessor receipts/old role permissions, exact grants,30-day session SQL/existing-session preservation, schema drift rejection and noop passed. Mock clean-source metadata is rehearsal only; hosted state unverified.');
}finally{
  await Promise.all(clients.map(client=>client.end().catch(()=>undefined)));
  if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  rmSync(root,{recursive:true,force:true});
}

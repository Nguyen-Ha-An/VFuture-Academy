#!/usr/bin/env node
// Disposable PostgreSQL contract; never points to a hosted database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { discoverStudioPostgresBinaries, createStudioFixtureClient } from './lib/studio-postgres-fixture.mjs';

const native = process.argv.includes('--native');
let loaded, db, cluster, nativeData, invoke;
if (native) {
  if (!process.env.STUDIO_POSTGRES_BIN) throw new Error('Native attachment contracts require explicit STUDIO_POSTGRES_BIN');
  const found = discoverStudioPostgresBinaries();
  cluster = mkdtempSync('/tmp/academy-attachments-pg.');
  nativeData = join(cluster, 'data');
  const socket = join(cluster, 'socket'); mkdirSync(socket, { mode: 0o700 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].includes(key)));
  invoke = (name, args) => execFileSync(join(found.bin, name), args, { env, stdio: 'pipe' });
  try {
    invoke('initdb', ['-D', nativeData, '-U', 'academy_attachment_test', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
    invoke('pg_ctl', ['-D', nativeData, '-l', join(cluster, 'postgres.log'), '-o', `-k ${socket} -p 55448 -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`, '-w', 'start']);
    const client = createStudioFixtureClient({ host: socket, port: 55448, user: 'academy_attachment_test', database: 'postgres' });
    await client.connect();
    assert.equal((await client.query('show listen_addresses')).rows[0].listen_addresses, '');
    assert.match((await client.query("select current_setting('server_version_num') as version")).rows[0].version, /^17\d{4}$/);
    db = { query: (...args) => client.query(...args), exec: sql => client.query(sql), close: () => client.end() };
  } catch (error) {
    if (existsSync(join(nativeData, 'postmaster.pid'))) invoke('pg_ctl', ['-D', nativeData, '-m', 'fast', '-w', 'stop']);
    rmSync(cluster, { recursive: true, force: true });
    throw error;
  }
} else {
  loaded = await loadPGlite(process.env.PGLITE_MODULE_PATH);
  db = new loaded.PGlite();
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.objects(bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    create table public.profiles(id uuid primary key,avatar_url text);
    create table public.media_assets(id text primary key,owner_id uuid,bucket text,path text,purpose text,item_id text,mime text,size_bytes bigint,width int,height int);
    create table public.course_versions(id uuid primary key,course_id text);
    create table public.course_version_items(version_id uuid,item_id text,primary key(version_id,item_id));
    create table public.course_version_item_renders(version_id uuid,item_id text,locale text,payload jsonb);
    create table public.exam_attempts(id uuid primary key,user_id uuid,course_version_id uuid,item_id text,status text,branch_id text,branch_scope_known boolean,question_set jsonb,started_at timestamptz,deadline_at timestamptz,submitted_at timestamptz,points numeric,max_points numeric,percent numeric,result_available_at timestamptz,late boolean);
    create table public.exam_answers(attempt_id uuid,user_id uuid,question_id text,answer jsonb,result jsonb,manual_points numeric,manual_feedback jsonb,graded_by uuid,updated_at timestamptz,primary key(attempt_id,question_id));
    create table public.quiz_attempts(user_id uuid,course_version_id uuid,item_id text,quiz_id text,answers jsonb);
    create table public.enrollments(user_id uuid,course_version_id uuid,course_id text,status text,branch_scope_known boolean,branch_id text);
    create table public.branch_memberships(user_id uuid,branch_id text,status text);
  `);
  await db.exec(readFileSync('supabase/migrations/20261025140618_academy_media_upload_reservations.sql', 'utf8'));
  const owner='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
  const attempt='20000000-0000-4000-8000-000000000001', version='30000000-0000-4000-8000-000000000001';
  const newerVersion='30000000-0000-4000-8000-000000000002';
  await db.query("insert into course_versions values($1,'course'),($2,'course')",[version,newerVersion]);
  const upload='40000000-0000-4000-8000-000000000001', quizUpload='40000000-0000-4000-8000-000000000003';
  const otherAttempt='20000000-0000-4000-8000-000000000002', lateUpload='40000000-0000-4000-8000-000000000002';
  const questionSet={ sections:[{id:'section',questionIds:['group'],deadlineOffsetMs:null}], learner:{sections:[{id:'section',questions:[{id:'group',type:'question_group',questions:[{id:'upload',type:'upload_answer',accepts:['file'],maxFiles:1,maxFileSizeMB:1,allowedMimeTypes:['application/pdf']},{id:'other-upload',type:'upload_answer',accepts:['file'],maxFiles:1}]}]}]} };
  const quizRender={blocks:[{id:'quiz',type:'quiz',questions:[{id:'quiz-upload',type:'upload_answer',selfAssessment:true,accepts:['file'],maxFiles:1}]}]};
  await db.query("insert into course_version_items values($1,'lesson')",[version]);
  await db.query("insert into course_version_item_renders values($1,'lesson','en',$2)",[version,quizRender]);
  const insertAttempt="insert into exam_attempts(id,user_id,course_version_id,item_id,status,branch_id,branch_scope_known,question_set,started_at,deadline_at) values($1,$2,$3,'exam','in_progress','school',true,$4,now(),now()+interval '1 hour')";
  await db.query(insertAttempt,[attempt,owner,version,questionSet]);
  await db.query(insertAttempt,[otherAttempt,owner,version,questionSet]);
  await db.query("insert into enrollments values($1,$2,'course','active',true,'school')",[owner,version]);
  // A legacy answer may already refer to an unbound asset before the migration.
  const legacy={upload:{files:[{assetId:'asset_legacy',name:'legacy.pdf',size:8,mime:'application/pdf'}]}};
  await db.query("insert into exam_answers(attempt_id,user_id,question_id,answer) values($1,$2,'group',$3)",[attempt,owner,legacy]);
  await db.exec(readFileSync('supabase/migrations/20261105030000_exam_attachment_bindings.sql', 'utf8'));
  await db.query("insert into exam_answers(attempt_id,user_id,question_id,answer) values($1,$2,'group',$3) on conflict(attempt_id,question_id) do update set answer=excluded.answer",[attempt,owner,legacy]);
  await assert.rejects(db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{upload:{files:[{assetId:'asset_foreign',name:'x.pdf',size:8,mime:'application/pdf'}]}}]),/EXAM_ATTACHMENT_INVALID/);
  const request={name:'work.pdf',size:8,mime:'application/pdf',checksum:'a'.repeat(64),purpose:'submission',courseId:'course',itemId:'exam',blockId:null,examAttemptId:attempt,rootQuestionId:'group',questionId:'upload'};
  const reservation=(await db.query('select public.media_upload_reserve($1,$2,$3,$4) r',[owner,upload,'asset_exam',request])).rows[0].r;
  await db.query('insert into storage.objects values($1,$2,$3)',[reservation.bucket,reservation.ready_path,{size:8,mimetype:'application/pdf'}]);
  const claimed=(await db.query("select public.media_upload_transition($1,$2,'claim',null,'{}') r",[owner,upload])).rows[0].r;
  await assert.rejects(db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5)',[other,upload,attempt,claimed.lease_token,{}]),/UPLOAD_NOT_FOUND/);
  await assert.rejects(db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5)',[owner,upload,otherAttempt,claimed.lease_token,{}]),/UPLOAD_NOT_FOUND/);
  assert.equal((await db.query('select count(*)::int n from media_assets where id=$1',['asset_exam'])).rows[0].n,0,'Failed bind must not publish the asset');
  const ready=(await db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5) r',[owner,upload,attempt,claimed.lease_token,{}])).rows[0].r;
  assert.equal(ready.state,'ready');
  assert.equal((await db.query('select count(*)::int n from exam_attachment_bindings')).rows[0].n,1);
  await assert.rejects(db.query("update media_upload_reservations set request='{}' where id=$1",[upload]),/EXAM_ATTACHMENT_IMMUTABLE/);
  await assert.rejects(db.query("update media_assets set owner_id=$2 where id=$1",['asset_exam',other]),/EXAM_ATTACHMENT_IMMUTABLE/);
  await assert.rejects(db.query('delete from media_assets where id=$1',['asset_exam']),/EXAM_ATTACHMENT_IN_USE/);
  const file={assetId:'asset_exam',name:'work.pdf',size:8,mime:'application/pdf'};
  await db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{upload:{files:[file]}}]);
  await assert.rejects(db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{'other-upload':{files:[file]}}]),/EXAM_ATTACHMENT_INVALID/);
  await assert.rejects(db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{upload:{files:[file,file]}}]),/EXAM_ATTACHMENT_INVALID/);
  await assert.rejects(db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{upload:{files:[{...file,size:9}]}}]),/EXAM_ATTACHMENT_INVALID/);
  await assert.rejects(db.query("update exam_answers set answer=$3 where attempt_id=$1 and user_id=$2",[attempt,owner,{upload:{files:[{assetId:'asset_exam',name:'work.pdf',mime:'application/pdf'}]}}]),/EXAM_ATTACHMENT_INVALID/);
  const lateRequest={...request,checksum:'b'.repeat(64)};
  const pending=(await db.query('select public.media_upload_reserve($1,$2,$3,$4) r',[owner,lateUpload,'asset_second',lateRequest])).rows[0].r;
  await db.query('insert into storage.objects values($1,$2,$3)',[pending.bucket,pending.ready_path,{size:8,mimetype:'application/pdf'}]);
  const lateClaim=(await db.query("select public.media_upload_transition($1,$2,'claim',null,'{}') r",[owner,lateUpload])).rows[0].r;
  await db.query("update exam_attempts set status='pending_manual',submitted_at=now() where id=$1",[attempt]);
  await assert.rejects(db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5)',[owner,lateUpload,attempt,lateClaim.lease_token,{}]),/UPLOAD_EXPIRED/);
  assert.equal((await db.query('select count(*)::int n from media_assets where id=$1',['asset_second'])).rows[0].n,0,'Submit/finalize race must roll back ready transition');
  assert.equal((await db.query('select state from media_upload_reservations where id=$1',[lateUpload])).rows[0].state,'finalizing');
  assert.equal((await db.query('select public.exam_attachment_ready($1,$2) r',[owner,upload])).rows[0].r.asset_id,'asset_exam');
  assert.equal((await db.query('select count(*)::int n from public.exam_attachment_gradeable_attempts($1,$2)',['asset_exam',owner])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.exam_attachment_gradeable_attempts($1,$2)',['asset_exam',other])).rows[0].n,0);
  // Execute the owning historical RPC definitions verbatim, not replicas. Their
  // INSERT ... ON CONFLICT fires BEFORE INSERT even for a pending-manual row.
  const gradingMigration=readFileSync('supabase/migrations/20260907092000_exam_result_availability.sql','utf8');
  for(const name of ['exam_finalize_attempt','exam_save_manual_draft','exam_complete_manual_grading']) {
    const definition=gradingMigration.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    assert.ok(definition,`Owning ${name} definition must remain identifiable`);
    await db.exec(definition[0]);
  }
  const manual={questionId:'group',answer:{upload:{files:[file]}},result:{status:'manual'},manualPoints:3,manualFeedback:{en:'Reviewed'},gradedBy:other,updatedAt:new Date().toISOString()};
  assert.equal((await db.query('select public.exam_save_manual_draft($1,$2) accepted',[attempt,manual])).rows[0].accepted,true,'Existing pending-manual answer remains gradeable');
  await assert.rejects(db.query('select public.exam_save_manual_draft($1,$2)',[attempt,{...manual,answer:{upload:{files:[]}}}]),/EXAM_ATTACHMENT_INVALID/,'Terminal grading cannot replace the submitted answer');
  const expected={group:{answer:manual.answer,manualPoints:3}};
  const completed=(await db.query('select public.exam_complete_manual_grading($1,$2,$3,$4,$5,$6,$7) result',[attempt,3,4,75,new Date().toISOString(),expected,JSON.stringify([manual])])).rows[0].result;
  assert.equal(completed.transitioned,true); assert.equal(completed.attempt.status,'graded');
  assert.equal((await db.query('select answer from exam_answers where attempt_id=$1',[attempt])).rows[0].answer.upload.files[0].assetId,'asset_exam');
  for(const [index,mode,existing] of [[20,'graded',true],[21,'pending_manual',true],[22,'graded',false]]) {
    const id=`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    await db.query(insertAttempt,[id,owner,version,questionSet]);
    if(existing)await db.query("insert into exam_answers(attempt_id,user_id,question_id,answer) values($1,$2,'text',$3)",[id,owner,JSON.stringify('Kept response')]);
    const answers=[{questionId:'text',answer:existing?'Kept response':null,result:{status:mode==='graded'?'incorrect':'manual'},manualPoints:null,manualFeedback:null,gradedBy:null,updatedAt:new Date().toISOString()}];
    const expected=existing?{text:'Kept response'}:{};
    const finalized=(await db.query('select public.exam_finalize_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[id,mode,false,new Date().toISOString(),0,1,0,expected,JSON.stringify(answers),mode==='graded'?new Date().toISOString():null])).rows[0].result;
    assert.equal(finalized.transitioned,true,`Existing ${mode} finalization with ${existing?'partial':'no'} answers remains functional`);
    assert.equal(finalized.attempt.status,mode);
  }
  // Quiz attachment is bound before an attempt exists; quiz submission creates
  // the attempt only after validating this exact owner/version/question DTO.
  await db.query("insert into enrollments values($1,$2,'course','active',true,'school')",[other,version]);
  const quizRequest={...request,examAttemptId:undefined,courseVersionId:version,itemId:'lesson',quizId:'quiz',rootQuestionId:'quiz-upload',questionId:'quiz-upload'};
  delete quizRequest.examAttemptId;
  const quizReservation=(await db.query('select public.media_upload_reserve($1,$2,$3,$4) r',[other,quizUpload,'asset_quiz',quizRequest])).rows[0].r;
  await db.query('insert into storage.objects values($1,$2,$3)',[quizReservation.bucket,quizReservation.ready_path,{size:8,mimetype:'application/pdf'}]);
  const quizClaim=(await db.query("select public.media_upload_transition($1,$2,'claim',null,'{}') r",[other,quizUpload])).rows[0].r;
  const quizReady=(await db.query('select public.quiz_attachment_complete($1,$2,$3,$4) r',[other,quizUpload,quizClaim.lease_token,{}])).rows[0].r;
  assert.equal(quizReady.state,'ready');
  const quizFile={assetId:'asset_quiz',name:'work.pdf',size:8,mime:'application/pdf'};
  await db.query("insert into quiz_attempts values($1,$2,'lesson','quiz',$3)",[other,version,{'quiz-upload':{files:[quizFile]}}]);
  await assert.rejects(db.query("insert into quiz_attempts values($1,$2,'lesson','quiz',$3)",[owner,version,{'quiz-upload':{files:[quizFile]}}]),/QUIZ_ATTACHMENT_INVALID/);
  assert.equal((await db.query('select count(*)::int n from public.exam_attachment_gradeable_attempts($1,$2)',['asset_quiz',other])).rows[0].n,0,'Quiz files never gain exam grader access');
  await db.query("update enrollments set course_version_id=$2,branch_id='new-school' where user_id=$1",[other,newerVersion]);
  assert.equal((await db.query('select public.quiz_attachment_ready($1,$2) r',[other,quizUpload])).rows[0].r?.asset_id,'asset_quiz','An owned bound quiz upload survives same-course enrollment upgrade');
  assert.equal((await db.query('select public.quiz_attachment_complete($1,$2,$3,$4) r',[other,quizUpload,quizClaim.lease_token,{}])).rows[0].r.state,'ready');
  await db.query("insert into branch_memberships values($1,'school','suspended')",[other]);
  assert.equal((await db.query('select public.quiz_attachment_ready($1,$2) r',[other,quizUpload])).rows[0].r,null,'A quiz binding uses its original known school rather than the new school');
  await assert.rejects(db.query('select public.quiz_attachment_complete($1,$2,$3,$4)',[other,quizUpload,quizClaim.lease_token,{}]),/UPLOAD_/);
  await db.query("delete from branch_memberships where user_id=$1",[other]);
  // Match existing learner admission: unknown school is not a new role gate,
  // and a new enrollment school never overwrites the original attempt school.
  for (const [index, known, originalBranch, enrollmentBranch] of [[10,false,null,null],[11,true,'school','other-school']]) {
    const policyOwner=`10000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    const policyAttempt=`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    const policyUpload=`40000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    const policyAsset=`asset_policy${index}`;
    await db.query("insert into enrollments values($1,$2,'course','active',$3,$4)",[policyOwner,version,enrollmentBranch!==null,enrollmentBranch]);
    await db.query("insert into exam_attempts(id,user_id,course_version_id,item_id,status,branch_id,branch_scope_known,question_set,started_at,deadline_at) values($1,$2,$3,'exam','in_progress',$4,$5,$6,now(),now()+interval '1 hour')",[policyAttempt,policyOwner,version,originalBranch,known,questionSet]);
    const policyRequest={...request,examAttemptId:policyAttempt,checksum:String(index%10).repeat(64)};
    const held=(await db.query('select public.media_upload_reserve($1,$2,$3,$4) r',[policyOwner,policyUpload,policyAsset,policyRequest])).rows[0].r;
    await db.query('insert into storage.objects values($1,$2,$3)',[held.bucket,held.ready_path,{size:8,mimetype:'application/pdf'}]);
    const lease=(await db.query("select public.media_upload_transition($1,$2,'claim',null,'{}') r",[policyOwner,policyUpload])).rows[0].r;
    assert.equal((await db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5) r',[policyOwner,policyUpload,policyAttempt,lease.lease_token,{}])).rows[0].r.state,'ready');
    await db.query("update exam_attempts set status='pending_manual',submitted_at=now() where id=$1",[policyAttempt]);
    assert.equal((await db.query('select public.exam_attachment_ready($1,$2) r',[policyOwner,policyUpload])).rows[0].r.asset_id,policyAsset,'Read-only bound replay permits terminal/unknown-school owner');
    await db.query('update enrollments set course_version_id=$2 where user_id=$1',[policyOwner,newerVersion]);
    assert.equal((await db.query('select public.exam_attachment_ready($1,$2) r',[policyOwner,policyUpload])).rows[0].r?.asset_id,policyAsset,'An owned bound exam upload survives same-course enrollment upgrade');
    assert.equal((await db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5) r',[policyOwner,policyUpload,policyAttempt,lease.lease_token,{}])).rows[0].r.state,'ready');
    if (known) {
      await db.query("insert into branch_memberships values($1,'school','suspended')",[policyOwner]);
      assert.equal((await db.query('select public.exam_attachment_ready($1,$2) r',[policyOwner,policyUpload])).rows[0].r,null,'Original known school suspension blocks ready replay');
      await assert.rejects(db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5)',[policyOwner,policyUpload,policyAttempt,lease.lease_token,{}]),/UPLOAD_/,'Atomic completion replay cannot bypass the same school gate');
      await db.query("delete from branch_memberships where user_id=$1 and branch_id='school'",[policyOwner]);
    }
    await db.query("update enrollments set status='dropped' where user_id=$1",[policyOwner]);
    assert.equal((await db.query('select public.exam_attachment_ready($1,$2) r',[policyOwner,policyUpload])).rows[0].r,null,'Dropped enrollment does not retain replay authorization');
    await assert.rejects(db.query('select public.exam_attachment_complete($1,$2,$3,$4,$5)',[policyOwner,policyUpload,policyAttempt,lease.lease_token,{}]),/UPLOAD_/);
  }
  console.log(`${native ? 'Native socket-only PostgreSQL17' : 'PGlite'} exam/quiz attachment binding, historical replay and scoped link contracts passed.`);
} finally {
  await db.close();
  if (native) {
    invoke('pg_ctl', ['-D', nativeData, '-m', 'fast', '-w', 'stop']);
    rmSync(cluster, { recursive: true, force: true });
  }
  if (loaded?.temporaryPrefix) rmSync(loaded.temporaryPrefix,{recursive:true,force:true});
}

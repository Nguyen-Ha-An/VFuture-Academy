#!/usr/bin/env node
// Disposable local PostgreSQL only: real teaching helpers and guarded exam RPCs.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';
const loaded = await loadPGlite(process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite, { until: '20261106011000_exam_teaching_scope.sql', hostedFunctionDefaults: true });
  const id = suffix => `97000000-0000-4000-8000-${String(suffix).padStart(12,'0')}`;
  const [manager, teacher, globalTeacher, centralAdmin, learner, otherLearner, unknownLearner] = [1,2,3,4,5,6,7].map(id);
  const version=id(11), foreignVersion=id(12);
  const [assigned, foreignCourse, foreignBranch, unknown] = [21,22,23,24].map(id);
  await db.exec(`
    insert into auth.users(id,email) values ${[manager,teacher,globalTeacher,centralAdmin,learner,otherLearner,unknownLearner].map((user,index)=>`('${user}','exam-teaching-${index}@example.test')`).join(',')};
    insert into public.branch_memberships(user_id,branch_id) values ('${manager}','ans'),('${teacher}','ans'),('${learner}','ans'),('${otherLearner}','vinsmc');
    insert into public.role_assignments(user_id,role_definition_id,branch_id) values ('${manager}','school_admin','ans'),('${teacher}','teacher','ans');
    insert into public.role_assignments(user_id,role_definition_id) values ('${centralAdmin}','central_admin');
    insert into public.role_definitions(id,name,scope_kind,permissions) values ('exam_global_teacher','Global exam operation','central',array['submission.grade','exam.release']);
    insert into public.role_assignments(user_id,role_definition_id) values ('${globalTeacher}','exam_global_teacher');
    insert into public.courses(id,owner_id,status) values ('exam-teaching-course','${manager}','published'),('exam-foreign-course','${manager}','published');
    insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values
      ('${version}','exam-teaching-course',1,'{}','fixture','{}','${manager}'),('${foreignVersion}','exam-foreign-course',1,'{}','fixture','{}','${manager}');
    update public.courses set current_version_id='${version}' where id='exam-teaching-course';
    update public.courses set current_version_id='${foreignVersion}' where id='exam-foreign-course';
    insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values
      ('${version}','exam-teaching-course','{}','{}','{"scope":"global"}','{}','{}',array['vi'],'vi'),
      ('${foreignVersion}','exam-foreign-course','{}','{}','{"scope":"global"}','{}','{}',array['vi'],'vi');
    insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values
      ('${version}','exam-one','exam','{}','{}','fixture'),('${foreignVersion}','exam-one','exam','{}','{}','fixture');
    update public.profiles set branch_id='ans' where id='${learner}';
    update public.profiles set branch_id='vinsmc' where id='${otherLearner}';
    insert into public.enrollments(user_id,course_id,course_version_id) values
      ('${learner}','exam-teaching-course','${version}'),('${learner}','exam-foreign-course','${foreignVersion}'),
      ('${otherLearner}','exam-teaching-course','${version}'),('${unknownLearner}','exam-teaching-course','${version}');
    insert into public.exam_attempts(id,user_id,course_version_id,item_id,attempt_no,status,question_set,grading_snapshot,submitted_at) values
      ('${assigned}','${learner}','${version}','exam-one',1,'pending_manual','{}','{}',now()),
      ('${foreignCourse}','${learner}','${foreignVersion}','exam-one',1,'pending_manual','{}','{}',now()),
      ('${foreignBranch}','${otherLearner}','${version}','exam-one',1,'pending_manual','{}','{}',now()),
      ('${unknown}','${unknownLearner}','${version}','exam-one',1,'pending_manual','{}','{}',now());
  `);
  const replace=(revision,teachers)=>db.query('select public.replace_course_teachers($1,$2,$3,$4,$5)',[manager,'exam-teaching-course','ans',revision,JSON.stringify(teachers)]);
  const teachers=[{userId:teacher,role:'primary'}]; await replace(0,teachers);
  const answer=actor=>({questionId:'essay',answer:'Written response',result:{questionId:'essay',status:'correct',points:1,maxPoints:1},manualPoints:1,manualFeedback:'Feedback',gradedBy:actor,updatedAt:'2026-11-06T00:00:00Z'});
  const asService=async run=>{await db.exec('set role service_role');try{return await run();}finally{await db.exec('reset role');}};
  const draft=(attempt,actor)=>asService(()=>db.query('select public.exam_save_manual_draft($1,$2,$3) value',[attempt,answer(actor),actor]));
  const complete=(attempt,actor)=>asService(()=>db.query('select public.exam_complete_manual_grading($1,1,1,100,$2,$3,$4,$5) value',[attempt,'2026-11-06T00:00:00Z',{essay:{answer:'Written response',manualPoints:1}},[answer(actor)],actor]));
  const release=(attempt,actor)=>asService(()=>db.query('select public.exam_release_attempt($1,$2,$3) value',[attempt,'2026-11-06T00:10:00Z',actor]));
  const snapshot=async()=> (await db.query('select to_jsonb(a) row from public.exam_attempts a order by id')).rows;
  const denied=async(attempt,actor)=>{
    const before=await snapshot();
    for(const action of [draft,complete,release]) await assert.rejects(action(attempt,actor),error=>error.code==='42501');
    assert.deepEqual(await snapshot(),before,'denied calls leave all attempts unchanged');
  };
  for(const [attempt,actor] of [[foreignCourse,teacher],[foreignBranch,teacher],[unknown,teacher],[assigned,globalTeacher],[unknown,globalTeacher],[assigned,manager],[assigned,null]]) await denied(attempt,actor);
  assert.equal((await draft(assigned,teacher)).rows[0].value,true);
  assert.equal((await complete(assigned,teacher)).rows[0].value.transitioned,true);
  assert.equal((await release(assigned,teacher)).rows[0].value.transitioned,true);
  await replace(1,[]); await denied(assigned,teacher); await replace(2,teachers);
  await db.exec(`update public.branch_memberships set status='suspended' where user_id='${teacher}'`); await denied(assigned,teacher);
  await db.exec(`update public.branch_memberships set status='active' where user_id='${teacher}'; update public.user_accounts set status='suspended',suspended_at=now() where user_id='${teacher}'`); await denied(assigned,teacher);
  assert.equal((await draft(unknown,centralAdmin)).rows[0].value,true);
  assert.equal((await complete(unknown,centralAdmin)).rows[0].value.transitioned,true);
  assert.equal((await release(unknown,centralAdmin)).rows[0].value.transitioned,true);
  await assert.rejects(asService(()=>db.query('select public.exam_save_manual_draft($1,$2,$3)',[unknown,answer(teacher),centralAdmin])),error=>error.code==='42501');
  const signatures=[['exam_save_manual_draft','uuid,jsonb'],['exam_complete_manual_grading','uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb'],['exam_release_attempt','uuid,timestamptz']];
  for(const [name,args] of signatures){
    const row=(await db.query(`select has_function_privilege('service_role',$1,'execute') legacy,has_function_privilege('service_role',$2,'execute') guarded,has_function_privilege('authenticated',$2,'execute') authenticated,has_function_privilege('anon',$2,'execute') anon`,[`public.${name}(${args})`,`public.${name}(${args},uuid)`])).rows[0];
    assert.deepEqual(row,{legacy:false,guarded:true,authenticated:false,anon:false});
  }
  console.log('Exam teaching SQL: exact historical course/school, global instructor denial, scope-all plus base rights, revoke/membership/account checks, all three service-role mutation overloads, grader identity and legacy RPC revocations passed.');
} finally {
  if(db) await db.close();
  if(loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix,{recursive:true,force:true});
}

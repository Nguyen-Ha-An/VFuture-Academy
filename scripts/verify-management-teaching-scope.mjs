#!/usr/bin/env node
// Actual isolated PostgreSQL checks for management and analytics teaching scopes.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';
const loaded = await loadPGlite(process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite, { until: '20261106040000_management_teaching_scope.sql', hostedFunctionDefaults: true });
  // Exercise a UTC instant that is already the next calendar day in this session.
  await db.exec("set timezone = 'Asia/Ho_Chi_Minh'");
  const id = n => `96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const [manager, teacher, memberReader, globalTeacher, admin, learner, other, unknown, va, vb] = [1,2,3,4,5,6,7,8,11,12].map(id);
  await db.exec(`
   insert into auth.users(id,email) values ${[manager,teacher,memberReader,globalTeacher,admin,learner,other,unknown].map((u,i)=>`('${u}','mgmt-scope-${i}@test.example')`).join(',')};
   insert into public.branch_memberships(user_id,branch_id) values ('${manager}','ans'),('${teacher}','ans'),('${memberReader}','ans'),('${learner}','ans'),('${other}','vinsmc');
   insert into public.role_assignments(user_id,role_definition_id,branch_id) values ('${manager}','school_admin','ans'),('${teacher}','teacher','ans');
   insert into public.role_definitions(id,name,scope_kind,permissions) values
    ('mgmt_scoped_member','Member and teaching','branch',array['admin.access','member.read','learning.read','grading.read','report.branch.read']),
    ('mgmt_global_teacher','Global instructor','central',array['admin.access','member.read','learning.read','grading.read','report.global.read']);
   insert into public.role_assignments(user_id,role_definition_id,branch_id) values ('${memberReader}','mgmt_scoped_member','ans');
   insert into public.role_assignments(user_id,role_definition_id) values ('${globalTeacher}','mgmt_global_teacher'),('${admin}','central_admin');
   insert into public.courses(id,owner_id,status) values ('mgmt-course-a','${manager}','published'),('mgmt-course-b','${manager}','published');
   insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values ('${va}','mgmt-course-a',1,'{}','fixture','{}','${manager}'),('${vb}','mgmt-course-b',1,'{}','fixture','{}','${manager}');
   update public.courses set current_version_id='${va}' where id='mgmt-course-a';
   update public.courses set current_version_id='${vb}' where id='mgmt-course-b';
   insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values ('${va}','mgmt-course-a','{}','{}','{"scope":"global"}','{}','{}',array['vi'],'vi'),('${vb}','mgmt-course-b','{}','{}','{"scope":"global"}','{}','{}',array['vi'],'vi');
   insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values ('${va}','exam-one','exam','{}','{}','f'),('${vb}','exam-one','exam','{}','{}','f');
   update public.profiles set branch_id='ans' where id='${learner}'; update public.profiles set branch_id='vinsmc' where id='${other}';
   insert into public.enrollments(user_id,course_id,course_version_id,enrolled_at) values ('${learner}','mgmt-course-a','${va}','2026-02-01 23:59:59+00'),('${learner}','mgmt-course-b','${vb}','2026-02-01 23:59:59+00'),('${other}','mgmt-course-a','${va}','2026-02-01 23:59:59+00'),('${unknown}','mgmt-course-a','${va}','2026-02-01 23:59:59+00');
   insert into public.exam_attempts(id,user_id,course_version_id,item_id,attempt_no,status,question_set,grading_snapshot,submitted_at) values
     ('${id(21)}','${learner}','${va}','exam-one',1,'pending_manual','{}','{}','2026-02-01 23:59:59+00'),('${id(22)}','${learner}','${vb}','exam-one',1,'pending_manual','{}','{}','2026-02-01 23:59:59+00'),('${id(23)}','${other}','${va}','exam-one',1,'pending_manual','{}','{}','2026-02-01 23:59:59+00'),('${id(24)}','${unknown}','${va}','exam-one',1,'pending_manual','{}','{}','2026-02-01 23:59:59+00');
   insert into public.assignment_submissions(id,user_id,course_version_id,item_id,attempt_no,payload,status) values
     ('${id(31)}','${learner}','${va}','exam-one',1,'{}','submitted'),('${id(32)}','${learner}','${vb}','exam-one',1,'{}','submitted'),('${id(33)}','${other}','${va}','exam-one',1,'{}','submitted'),('${id(34)}','${unknown}','${va}','exam-one',1,'{}','submitted');
   -- Current profile transfer must not change the historic enrollment branch.
   update public.profiles set branch_id='ans' where id in ('${other}','${unknown}');
   insert into public.course_teaching_groups(course_id,branch_id,revision) values ('mgmt-course-a','ans',1);
   insert into public.course_teaching_assignments(course_id,branch_id,user_id,role) values ('mgmt-course-a','ans','${teacher}','primary'),('mgmt-course-a','ans','${memberReader}','assistant');
  `);
  const read=(actor,kind,branch,op,input={})=>db.query('select public.admin_management_read($1,$2,$3,$4,$5) value',[actor,kind,branch,op,input]).then(r=>r.rows[0].value);
  const dashboard=await read(teacher,'branch','ans','dashboard');
  assert.equal(dashboard.enrollments,1); assert.equal(dashboard.pendingGrading,1);
  const reports=await read(teacher,'branch','ans','reports'); assert.equal(reports[0].enrollments,1);
  const user=await read(memberReader,'branch','ans','user',{userId:learner});
  assert.equal(user.id,learner); assert.deepEqual(user.learning.map(x=>x.courseId),['mgmt-course-a']); assert.deepEqual(user.examResults.map(x=>x.id),[id(21)]); assert.deepEqual(user.submissions.map(x=>x.id),[id(31)]);
  for (const transferred of [other, unknown]) { const detail=await read(memberReader,'branch','ans','user',{userId:transferred}); assert.deepEqual(detail.learning,[]); assert.deepEqual(detail.submissions,[]); assert.deepEqual(detail.examResults,[]); }
  const central=await read(admin,'central',null,'dashboard'); assert.equal(central.enrollments,4);
  assert.equal((await read(globalTeacher,'central',null,'dashboard')).enrollments,0);
  const daily=()=>db.query("select * from public.teaching_analytics_daily($1,$2,date '2026-02-01',date '2026-02-01')",[teacher,'ans']).then(r=>r.rows[0]);
  const row=await daily(); assert.equal(Number(row.enrollments),1); assert.equal(Number(row.exam_attempts),1);
  const boundary=(await db.query("select ('2026-02-01 23:59:59+00'::timestamptz)::date::text local_day")).rows[0];
  assert.equal(boundary.local_day,'2026-02-02','Fixture instant crosses the non-UTC session calendar boundary');
  const nextDay=(await db.query("select * from public.teaching_analytics_daily($1,$2,date '2026-02-02',date '2026-02-02')",[teacher,'ans'])).rows[0];
  assert.equal(Number(nextDay.enrollments),0); assert.equal(Number(nextDay.exam_attempts),0);
  const allRow=(await db.query("select * from public.teaching_analytics_daily($1,$2,date '2026-02-01',date '2026-02-01')",[admin,'ans'])).rows[0]; assert.equal(Number(allRow.enrollments),2); assert.equal(Number(allRow.exam_attempts),2);
  assert.equal(Number((await db.query('select public.teaching_analytics_pending($1,$2) n',[teacher,'ans'])).rows[0].n),2);
  const course=(await db.query("select * from public.teaching_analytics_course_daily($1,$2,date '2026-02-01',date '2026-02-01')",[teacher,'ans'])).rows;
  assert.deepEqual(course.map(x=>x.course_id),['mgmt-course-a']);
  await db.exec(`
    insert into public.exam_attempts(id,user_id,course_version_id,item_id,attempt_no,status,question_set,grading_snapshot,submitted_at,percent) values
     ('${id(41)}','${learner}','${va}','exam-one',2,'graded','{}','{}',now(),0),('${id(42)}','${learner}','${va}','exam-one',3,'graded','{}','{}',now(),100);
    insert into public.exam_grades(user_id,course_version_id,item_id,percent,passed,policy) values ('${learner}','${va}','exam-one',100,true,'best');
  `);
  assert.equal((await read(memberReader,'branch','ans','user',{userId:learner})).learning[0].examAveragePercent,100,'Best policy applies per exam, not per attempt');
  await db.exec(`delete from public.course_teaching_assignments where user_id in ('${teacher}','${memberReader}')`);
  assert.equal((await read(teacher,'branch','ans','dashboard')).enrollments,0);
  assert.equal((await read(teacher,'branch','ans','reports'))[0].enrollments,0);
  assert.deepEqual((await read(memberReader,'branch','ans','user',{userId:learner})).learning,[]);
  assert.equal(Number((await daily()).exam_attempts),0);
  const grants=(await db.query(`select has_function_privilege('authenticated','public.teaching_analytics_daily(uuid,text,date,date)','execute') client,has_function_privilege('service_role','public.teaching_analytics_daily(uuid,text,date,date)','execute') service`)).rows[0];
  assert.deepEqual(grants,{client:false,service:true});
  console.log('Management SQL scopes dashboard, reports, member learning and analytics before aggregation; revocation and service-only grants passed.');
} finally { if(db) await db.close(); if(loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix,{recursive:true,force:true}); }

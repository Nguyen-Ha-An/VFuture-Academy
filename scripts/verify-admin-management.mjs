#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminTestDatabase, loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

export async function verifyAdminManagement(PGlite) {
  const {db,ids}=await createAdminTestDatabase(PGlite);
  const one=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
  const read=async(actor,scope,operation,input={}) => (await one('select public.admin_management_read($1,$2,$3,$4,$5) result',[actor,scope?'branch':'central',scope,operation,input])).result;
  const write=async(actor,scope,operation,input) => (await one('select public.admin_management_write($1,$2,$3,$4,$5) result',[actor,scope?'branch':'central',scope,operation,input])).result;
  try {
    await db.exec(`
      alter table public.profiles add column updated_at timestamptz not null default now();
      alter table public.lesson_progress add column course_version_id uuid, add column status text;
      alter table public.assignment_submissions add column status text not null default 'submitted', add column submitted_at timestamptz not null default now();
      create table public.course_version_items(version_id uuid,item_id text,kind text);
      create table public.grades(submission_id uuid,total_points numeric,max_points numeric);
      create table public.exam_grades(user_id uuid,course_version_id uuid,percent numeric);
      alter table public.exam_attempts add column status text default 'graded', add column submitted_at timestamptz default now(), add column percent numeric;
    `);
    const original=readFileSync(resolve(repositoryRoot,'supabase/migrations/0010_analytics_views.sql'),'utf8');
    await db.exec(original.slice(original.indexOf('create table public.admin_user_search_buckets'),original.indexOf('create or replace function public.admin_find_user_by_email')));
    await db.exec(readFileSync(resolve(repositoryRoot,'supabase/migrations/0033_fix_admin_search_clock.sql'),'utf8'));
    await db.exec(readFileSync(resolve(repositoryRoot,'supabase/migrations/20260906065949_admin_management.sql'),'utf8').split('-- Legacy reporting interfaces')[0]);
    const options=await read(ids.admin1,null,'options');
    assert.ok(options.roles.some(role=>role.id==='central_admin'));
    assert.equal(options.branches.length,2);
    assert.equal((await read(ids.admin1,null,'users')).items.length,4);

    await db.query("insert into public.branch_memberships(user_id,branch_id,status) values($1,'school-a','active')",[ids.admin2]);
    await write(ids.admin1,null,'user.role',{userId:ids.admin2,roleId:'school_admin',branchId:'school-a',enabled:true});
    const schoolOptions=await read(ids.admin2,'school-a','options');
    assert.ok(schoolOptions.roles.every(role=>role.scopeKind==='branch'&&role.grantableBySchool));
    assert.ok(!schoolOptions.permissions.includes('submission.grade'));
    const directory=await read(ids.admin2,'school-a','users');
    assert.ok(!directory.items.some(member=>member.id===ids.admin1));
    assert.equal((await read(ids.admin2,'school-a','users',{query:'admin1@example.test'})).items.length,0);
    await assert.rejects(()=>read(ids.admin2,'school-a','user',{userId:ids.admin1}),{code:'P0002'});
    await assert.rejects(()=>read(ids.admin2,'school-b','users'));
    await assert.rejects(()=>write(ids.admin2,'school-a','user.role',{userId:ids.learner,roleId:'central_admin',branchId:null,enabled:true}));
    await assert.rejects(()=>write(ids.admin2,'school-a','user.role',{userId:ids.admin2,roleId:'teacher',branchId:'school-a',enabled:true}));
    await assert.rejects(()=>write(ids.admin2,'school-a','user.identity',{userId:ids.learner,displayName:'Changed globally'}));
    await assert.rejects(()=>write(ids.admin1,null,'role.create',{name:'Bad publisher',description:'',scopeKind:'branch',permissions:['admin.access','content.publish'],grantableBySchool:true}));

    const custom=await write(ids.admin1,null,'role.create',{name:'School reader',description:'Read members only',scopeKind:'branch',permissions:['admin.access','member.read'],grantableBySchool:true});
    await write(ids.admin2,'school-a','user.role',{userId:ids.learner,roleId:custom.id,branchId:'school-a',enabled:true});
    const detail=await read(ids.admin2,'school-a','user',{userId:ids.learner});
    assert.ok(detail.assignments.some(assignment=>assignment.roleId===custom.id));
    assert.equal(detail.actions.readSubmissions,false);
    assert.equal(detail.submissions,undefined);
    assert.equal(detail.actions.editIdentity,false);
    const created=await write(ids.admin2,'school-a','invitation.create',{email:'learner@example.test',branchId:'school-a',roleId:custom.id,tokenHash:'a'.repeat(64)});
    assert.equal(created.status,'pending');
    assert.ok(!('tokenHash' in created));
    const roleUpdate={roleId:custom.id,name:'School reader updated',description:'',scopeKind:'branch',permissions:['admin.access','member.read'],grantableBySchool:true,version:custom.version};
    await write(ids.admin1,null,'role.update',roleUpdate);
    await assert.rejects(()=>write(ids.admin1,null,'role.update',roleUpdate),{code:'40001'});
    await assert.rejects(()=>db.query('select public.admin_accept_invitation($1,$2)',[ids.learner,'a'.repeat(64)]));

    const accepted=await write(ids.admin2,'school-a','invitation.create',{email:'learner@example.test',branchId:'school-a',roleId:null,tokenHash:'b'.repeat(64)});
    await db.query('select public.admin_accept_invitation($1,$2)',[ids.learner,'b'.repeat(64)]);
    await assert.rejects(()=>db.query('select public.admin_accept_invitation($1,$2)',[ids.learner,'b'.repeat(64)]));
    assert.equal((await read(ids.admin2,'school-a','invitations')).find(i=>i.id===accepted.id).status,'accepted');
    await write(ids.admin2,'school-a','invitation.create',{email:'learner@example.test',branchId:'school-a',roleId:null,tokenHash:'c'.repeat(64)});
    await assert.rejects(()=>db.query('select public.admin_accept_invitation($1,$2)',[ids.teacher,'c'.repeat(64)]));

    await db.query(`insert into public.enrollments(id,user_id,course_id,course_version_id) values($1,$2,'current-course','10000000-0000-4000-8000-000000000002')`,[ids.enrollment,ids.learner]);
    await db.query(`insert into public.assignment_submissions(id,user_id,course_version_id,item_id) values($1,$2,'10000000-0000-4000-8000-000000000002','assignment')`,[ids.submission,ids.learner]);
    await db.query(`insert into public.exam_attempts(id,user_id,course_version_id,item_id,status,percent) values($1,$2,'10000000-0000-4000-8000-000000000002','exam','graded',80)`,[ids.attempt,ids.learner]);
    await db.query(`insert into public.exam_grades(user_id,course_version_id,percent) values($1,'10000000-0000-4000-8000-000000000002',80)`,[ids.learner]);
    await write(ids.admin1,null,'user.transfer',{userId:ids.learner,branchId:'school-b'});
    assert.equal((await one('select branch_id from public.assignment_submissions where id=$1',[ids.submission])).branch_id,'school-a');
    const globalDetail=await read(ids.admin1,null,'user',{userId:ids.learner});
    assert.equal(globalDetail.submissions.length,1);
    assert.equal(globalDetail.learning.length,2);
    assert.equal(globalDetail.examResults.length,1);
    const destinationDetail=await read(ids.admin1,'school-b','user',{userId:ids.learner});
    assert.equal(destinationDetail.submissions.length,0);assert.equal(destinationDetail.examResults.length,0);
    assert.equal(Number(destinationDetail.learning.find(course=>course.courseId==='current-course').examAveragePercent),80);
    await assert.rejects(()=>write(ids.admin1,null,'user.role',{userId:ids.admin1,roleId:'central_admin',branchId:null,enabled:false}),/LAST_ADMIN|final active/i);
    await assert.rejects(()=>write(ids.admin1,null,'user.account-status',{userId:ids.admin1,status:'suspended'}),/LAST_ADMIN|final active/i);
    await write(ids.admin1,null,'user.membership-status',{userId:ids.admin2,branchId:'school-a',status:'suspended'});
    await assert.rejects(()=>read(ids.admin2,'school-a','users'));
    await assert.rejects(()=>db.query('select public.admin_accept_invitation($1,$2)',[ids.learner,'c'.repeat(64)]));
    // Role administrators and global assigners cannot grant themselves capabilities they lack.
    const limitedDefinition=await write(ids.admin1,null,'role.create',{name:'Definition manager',description:'',scopeKind:'central',permissions:['admin.access','role.definition.manage'],grantableBySchool:false});
    await write(ids.admin1,null,'user.role',{userId:ids.admin2,roleId:limitedDefinition.id,branchId:null,enabled:true});
    await assert.rejects(()=>write(ids.admin2,null,'role.update',{roleId:limitedDefinition.id,name:'Definition manager',description:'',scopeKind:'central',permissions:['admin.access','role.definition.manage','content.publish'],grantableBySchool:false,version:1}),{code:'42501'});
    const limitedGranter=await write(ids.admin1,null,'role.create',{name:'Role assigner',description:'',scopeKind:'central',permissions:['admin.access','role.assignment.global'],grantableBySchool:false});
    await write(ids.admin1,null,'user.role',{userId:ids.admin2,roleId:limitedGranter.id,branchId:null,enabled:true});
    assert.ok(!(await read(ids.admin2,null,'options')).roles.some(role=>role.id==='central_admin'));
    await assert.rejects(()=>write(ids.admin2,null,'user.role',{userId:ids.admin2,roleId:'central_admin',branchId:null,enabled:true}),{code:'42501'});
    await assert.rejects(()=>write(ids.admin2,null,'user.role',{userId:ids.learner,roleId:'central_admin',branchId:null,enabled:true}),{code:'42501'});
    const branchReporter=await write(ids.admin1,null,'role.create',{name:'Branch reports',description:'',scopeKind:'central',permissions:['admin.access','report.branch.read'],grantableBySchool:false});
    await write(ids.admin1,null,'user.role',{userId:ids.admin2,roleId:branchReporter.id,branchId:null,enabled:true});
    await assert.rejects(()=>read(ids.admin2,null,'reports'),{code:'42501'});
    await write(ids.admin1,null,'branch.update',{branchId:'school-a',name:'School A renamed'});
    await write(ids.admin1,null,'branch.update',{branchId:'school-a',city:'New city'});
    const preserved=await one("select name,city from branches where id='school-a'");
    assert.equal(preserved.name,'School A renamed');assert.equal(preserved.city,'New city');
    const scopedAudits=await db.query("select before,after from audit_log where actor_id=$1 and branch_id is not null and target_type='user'",[ids.admin1]);
    assert.ok(scopedAudits.rows.every(row=>!row.before?.memberships&&!row.after?.memberships));
    const actorAudit=await read(ids.admin1,null,'audit',{actor:ids.admin2});
    assert.ok(actorAudit.every(entry=>entry.actorId===ids.admin2));
    await db.exec('set role authenticated');
    await assert.rejects(()=>db.query('select * from public.admin_invitations'));
    await assert.rejects(()=>read(ids.admin1,null,'users'));
    await db.exec('reset role');
  } finally { await db.close(); }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const loaded=await loadPGlite(process.argv[2]??process.env.PGLITE_MODULE_PATH);
  try { await verifyAdminManagement(loaded.PGlite); console.log('Admin management PostgreSQL verification passed.'); }
  finally { if(loaded.temporaryPrefix)rmSync(loaded.temporaryPrefix,{recursive:true,force:true}); }
}

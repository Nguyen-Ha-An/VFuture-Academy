#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const loaded = await loadPGlite(process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite);
  const user='97000000-0000-4000-8000-000000000001';
  const version='97000000-0000-4000-8000-000000000002';
  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data) values ('${user}','teaching-test@example.test','{}');
    update public.profiles set branch_id='ans' where id='${user}';
    insert into public.courses(id,owner_id,status) values ('teaching-test','${user}','published');
    insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values ('${version}','teaching-test',1,'{}','fixture','{}','${user}');
    insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values ('${version}','task','assignment','{}','{}','fixture');
    insert into public.enrollments(user_id,course_id,course_version_id) values ('${user}','teaching-test','${version}');
    insert into public.assignment_schedules(branch_id,course_version_id,item_id,block_id,due_at,updated_by) values ('ans','${version}','task',null,'2026-11-01T00:00:00Z','${user}');
  `);
  const permission=await db.query("select id,permissions from public.role_definitions where id in ('teacher','school_admin','central_admin')");
  const role=Object.fromEntries(permission.rows.map(row=>[row.id,row.permissions]));
  for (const name of ['teaching.announcement.manage','teaching.schedule.manage']) {
    assert.ok(role.teacher.includes(name)); assert.ok(role.central_admin.includes(name)); assert.ok(!role.school_admin.includes(name));
  }
  const args=[user,'teaching-test',version,'task',null,null,'until_approved',{text:'first'},'2026-11-02T00:00:00Z',[]];
  const submit=()=>db.query('select public.submit_assignment_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',args).then(x=>x.rows[0].result);
  const first=await submit(); assert.equal(first.created,true);
  await db.exec("update public.assignment_schedules set due_at='2026-12-01T00:00:00Z' where branch_id='ans'");
  const retry=await submit(); assert.equal(retry.created,false); assert.equal(retry.id,first.id);
  const snapshot=await db.query('select due_at_snapshot::text,late,branch_id,branch_scope_known from public.assignment_submissions where id=$1',[first.id]);
  assert.match(snapshot.rows[0].due_at_snapshot,/2026-11-01/); assert.equal(snapshot.rows[0].late,true); assert.equal(snapshot.rows[0].branch_id,'ans'); assert.equal(snapshot.rows[0].branch_scope_known,true);
  await assert.rejects(db.query('update public.assignment_submissions set late=false where id=$1',[first.id]),/immutable/);
  args[5]=first.id; args[7]={text:'second'};
  const second=await submit(); assert.equal(second.created,true);
  const secondSnapshot=await db.query('select due_at_snapshot::text,late from public.assignment_submissions where id=$1',[second.id]);
  assert.match(secondSnapshot.rows[0].due_at_snapshot,/2026-12-01/); assert.equal(secondSnapshot.rows[0].late,false);
  const audit=await db.query("select action,after from public.audit_log where target_type='assignment_schedule' order by id");
  assert.equal(audit.rows.length,2); assert.equal(audit.rows[0].action,'teaching.schedule.update');
  await db.exec("alter table public.audit_log add constraint reject_teaching_audit check (action <> 'teaching.announcement.create')");
  await assert.rejects(db.exec(`insert into public.teaching_announcements(branch_id,course_id,title,body,created_by,updated_by) values ('ans','teaching-test','Title','Body','${user}','${user}')`));
  assert.equal((await db.query('select count(*)::integer n from public.teaching_announcements')).rows[0].n,0,'Failed audit must roll back announcement');
  await db.exec('alter table public.audit_log drop constraint reject_teaching_audit');
  await db.exec('set role service_role');
  const created=await db.query(`insert into public.teaching_announcements(branch_id,course_id,title,body,created_by,updated_by) values ('ans','teaching-test','Title','Body','${user}','${user}') returning id,revision`);
  await db.exec('reset role');
  const announcementId=created.rows[0].id;
  assert.equal(created.rows[0].revision,1);
  const log=await db.query("select after from public.audit_log where target_id=$1",[announcementId]);
  assert.equal(log.rows.length,1); assert.ok(!JSON.stringify(log.rows[0]).includes('Body')); assert.equal(log.rows[0].after.revision,1);
  // Two operators read revision 1. Only the first update can win; the second
  // must not publish content it did not review.
  const edited=await db.query("update public.teaching_announcements set title='Updated' where id=$1 and status='draft' and revision=$2 returning revision",[announcementId,1]);
  assert.equal(edited.rows[0].revision,2);
  const stalePublish=await db.query("update public.teaching_announcements set status='published',published_at=now() where id=$1 and status='draft' and revision=$2 returning id",[announcementId,1]);
  assert.equal(stalePublish.rows.length,0);
  assert.equal((await db.query('select public.delete_teaching_announcement($1,$2,$3) deleted',[announcementId,user,1])).rows[0].deleted,false);
  await db.exec("alter table public.audit_log add constraint reject_teaching_edit check (action <> 'teaching.announcement.edit') not valid");
  await assert.rejects(db.query("update public.teaching_announcements set title='No audit' where id=$1 and revision=2",[announcementId]));
  const afterFailure=await db.query('select title,revision from public.teaching_announcements where id=$1',[announcementId]);
  assert.equal(afterFailure.rows[0].title,'Updated'); assert.equal(afterFailure.rows[0].revision,2);
  await db.exec('alter table public.audit_log drop constraint reject_teaching_edit');
  await db.exec("alter table public.audit_log add constraint reject_teaching_delete check (action <> 'teaching.announcement.delete')");
  await assert.rejects(db.query('select public.delete_teaching_announcement($1,$2,$3)',[announcementId,user,2]));
  assert.equal((await db.query('select count(*)::integer n from public.teaching_announcements where id=$1',[announcementId])).rows[0].n,1,'Failed deletion audit must restore announcement');
  await db.exec('alter table public.audit_log drop constraint reject_teaching_delete');
  await db.exec('set role service_role');
  assert.equal((await db.query('select public.delete_teaching_announcement($1,$2,$3) deleted',[announcementId,user,2])).rows[0].deleted,true);
  await db.exec('reset role');
  assert.equal((await db.query("select to_regprocedure('public.delete_teaching_announcement(uuid,uuid)') old_rpc")).rows[0].old_rpc,null);
  const deletion=await db.query("select before from public.audit_log where target_id=$1 and action='teaching.announcement.delete'",[announcementId]);
  assert.equal(deletion.rows[0].before.revision,2); assert.ok(!JSON.stringify(deletion.rows[0]).includes('Body'));
  const secondAnnouncement=await db.query(`insert into public.teaching_announcements(branch_id,course_id,title,body,created_by,updated_by) values ('ans','teaching-test','Publish','Private text','${user}','${user}') returning id,revision`);
  const secondId=secondAnnouncement.rows[0].id;
  const published=await db.query("update public.teaching_announcements set status='published',published_at=now(),revision=999 where id=$1 and status='draft' and revision=1 returning revision",[secondId]);
  assert.equal(published.rows[0].revision,2,'Database must control revision even if caller tries to set it');
  assert.equal((await db.query("update public.teaching_announcements set status='archived' where id=$1 and status='published' and revision=1 returning id",[secondId])).rows.length,0);
  const archived=await db.query("update public.teaching_announcements set status='archived' where id=$1 and status='published' and revision=2 returning revision",[secondId]);
  assert.equal(archived.rows[0].revision,3);
  const transitionLogs=await db.query('select before,after from public.audit_log where target_id=$1 order by id',[secondId]);
  assert.deepEqual(transitionLogs.rows.map(row=>row.after.revision),[1,2,3]);
  assert.ok(!JSON.stringify(transitionLogs.rows).includes('Private text'));
  const grants=await db.query("select has_table_privilege('authenticated','public.assignment_schedules','select') permitted");
  assert.equal(grants.rows[0].permitted,false);
  console.log('Teaching permissions, deadline snapshots, and retry behavior passed.');
} finally {
  if(db) await db.close();
  if(loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix,{recursive:true,force:true});
}

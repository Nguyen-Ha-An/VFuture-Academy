#!/usr/bin/env node

import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminTestDatabase, loadPGlite, foundationMigrationPath } from './lib/admin-db-harness.mjs';

async function rejects(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

export async function verifyAdminFoundation(PGlite) {
  const { db, ids } = await createAdminTestDatabase(PGlite, {applyFoundation:false});
  await db.query("insert into public.user_roles(user_id,role,branch_id) values($1,'branch_lead',null)",[ids.admin2]);
  await db.exec(readFileSync(foundationMigrationPath,'utf8'));
  const centralLegacy = await db.query("select public.authorization_has_permission($1,'member.read','central',null) central_read, public.authorization_has_permission($1,'member.read','branch','school-a') branch_read, public.authorization_has_permission($1,'content.edit','central',null) content_edit",[ids.admin2]);
  if(centralLegacy.rows[0].central_read || !centralLegacy.rows[0].branch_read || centralLegacy.rows[0].content_edit) throw new Error('Legacy branch management broadened into Central or all-content authority');
  const one = (sql, params = []) => db.query(sql, params).then((result) => result.rows[0]);

  try {
    const oldHistory = await one(
      'select branch_id, branch_scope_known, branch_scope_source from public.enrollments where id = $1',
      [ids.oldEnrollment],
    );
    if (oldHistory.branch_id !== null || oldHistory.branch_scope_known || oldHistory.branch_scope_source !== 'unknown') {
      throw new Error('Existing enrollment history was guessed from the current profile');
    }

    await db.query(
      `insert into public.enrollments(id, user_id, course_id, course_version_id)
       values ($1, $2, 'new-course', '10000000-0000-4000-8000-000000000002')`,
      [ids.enrollment, ids.learner],
    );
    await db.query('update public.profiles set branch_id = $1 where id = $2', ['school-b', ids.learner]);
    await db.query(
      `insert into public.assignment_submissions(id, user_id, course_version_id, item_id)
       values ($1, $2, '10000000-0000-4000-8000-000000000002', 'assignment')`,
      [ids.submission, ids.learner],
    );
    await db.query(
      `insert into public.exam_attempts(id, user_id, course_version_id, item_id)
       values ($1, $2, '10000000-0000-4000-8000-000000000002', 'exam')`,
      [ids.attempt, ids.learner],
    );
    const inherited = await one(
      `select submission.branch_id submission_branch, attempt.branch_id attempt_branch
       from public.assignment_submissions submission
       join public.exam_attempts attempt on attempt.id = $2
       where submission.id = $1`,
      [ids.submission, ids.attempt],
    );
    if (inherited.submission_branch !== 'school-a' || inherited.attempt_branch !== 'school-a') {
      throw new Error('Submission or exam history followed a transferred profile instead of enrollment history');
    }

    await db.query(
      `insert into public.enrollments(id, user_id, course_id, course_version_id)
       values ($1, $2, 'transfer-course', '10000000-0000-4000-8000-000000000003')`,
      [ids.transferEnrollment, ids.learner],
    );
    const transfer = await one('select branch_id from public.enrollments where id = $1', [ids.transferEnrollment]);
    if (transfer.branch_id !== 'school-b') throw new Error('A new enrollment did not capture the new primary branch');

    const teacherInA = await one(
      `select public.authorization_has_permission($1, 'submission.grade', 'branch', 'school-a') allowed`,
      [ids.teacher],
    );
    const teacherInB = await one(
      `select public.authorization_has_permission($1, 'submission.grade', 'branch', 'school-b') allowed`,
      [ids.teacher],
    );
    if (!teacherInA.allowed || teacherInB.allowed) throw new Error('Cross-school role scope was not enforced');
    const teacherAdminAccess = await one(
      `select
         public.authorization_has_permission($1, 'admin.access', 'branch', 'school-a') admin_access,
         public.authorization_has_permission($1, 'grading.read', 'branch', 'school-a') grading_read,
         public.authorization_has_permission($1, 'grading.manage', 'branch', 'school-a') grading_manage,
         public.authorization_has_permission($1, 'report.branch.read', 'branch', 'school-a') report_read`,
      [ids.teacher],
    );
    if (!teacherAdminAccess.admin_access
      || !teacherAdminAccess.grading_read
      || !teacherAdminAccess.grading_manage
      || !teacherAdminAccess.report_read) {
      throw new Error('Migrated teaching staff lost access to replacement grading capabilities');
    }

    await rejects(
      () => db.query(`
        insert into public.role_definitions(
          id, name, scope_kind, permissions, built_in, school_grantable
        ) values ('malicious-branch-publisher', 'bad', 'branch', array['content.publish'], false, false)
      `),
      'A branch role definition accepted a central-only permission',
    );

    const actor = await one('select public.authorization_actor($1) actor', [ids.teacher]);
    if (actor.actor.accountStatus !== 'active'
      || actor.actor.memberships[0].branchId !== 'school-a'
      || actor.actor.assignments[0].scope.kind !== 'branch') {
      throw new Error('Actor authorization RPC returned an invalid contract');
    }

    await rejects(
      () => db.query("update public.role_definitions set name = 'Changed' where id = 'teacher'"),
      'A built-in role definition was mutable',
    );

    await db.query(`
      insert into public.role_assignments(user_id, role_definition_id, branch_id, granted_by)
      values ($1, 'central_admin', null, $2)
    `, [ids.admin2, ids.admin1]);
    const assignments = await db.query(
      "select id, user_id from public.role_assignments where role_definition_id = 'central_admin' order by user_id",
    );
    const deletionResults = await Promise.allSettled(assignments.rows.map(({ id }) =>
      db.query('delete from public.role_assignments where id = $1', [id])));
    if (deletionResults.filter(({ status }) => status === 'fulfilled').length !== 1
      || deletionResults.filter(({ status }) => status === 'rejected').length !== 1) {
      throw new Error('Concurrent central-admin revocations did not preserve exactly one admin');
    }
    const lastAdmin = await one(`
      select assignment.user_id
      from public.role_assignments assignment
      where assignment.role_definition_id = 'central_admin'
    `);
    await rejects(
      () => db.query("update public.user_accounts set status = 'suspended' where user_id = $1", [lastAdmin.user_id]),
      'The final active global admin account could be suspended',
    );

    await db.query("update public.user_accounts set status = 'suspended' where user_id = $1", [ids.learner]);
    await rejects(
      () => db.query("insert into public.analytics_events(user_id, name) values ($1, 'blocked')", [ids.learner]),
      'A suspended learner could create a protected analytics event',
    );
  } finally {
    await db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
  try {
    await verifyAdminFoundation(loaded.PGlite);
    console.log('Admin authorization foundation verification passed.');
  } finally {
    if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
  }
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite, {
    until: '20261106040000_management_teaching_scope.sql', hostedFunctionDefaults: true,
  });
  const names = ['central', 'lead', 'manager', 'mixed', 'retained', 'learner', 'newcomer', 'limited'];
  const users = Object.fromEntries(names.map((name, i) => [name, `97000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rpc = (sql, params) => db.transaction(async transaction => {
    await transaction.exec('set local role service_role');
    return (await transaction.query(sql, params)).rows[0].result;
  });
  const email = name => `${name}@school.example`;
  const digest = label => createHash('sha256').update(label).digest('hex');
  const write = (actor, school, operation, input) => rpc(
    'select public.admin_management_write($1,$2,$3,$4,$5) result', [users[actor], school ? 'branch' : 'central', school, operation, input],
  );
  const options = async actor => (await rpc("select public.admin_management_read($1,'branch','ans','options') result", [users[actor]])).roles.map(role => role.id);
  const grant = (actor, recipient, roleId, enabled = true) => write(actor, actor === 'central' ? null : 'ans', 'user.role', { userId: users[recipient], branchId: 'ans', roleId, enabled });
  const invite = (actor, recipient, roleId, label, branchId = 'ans') => write(actor, actor === 'central' ? null : branchId, 'invitation.create', { email: email(recipient), branchId, roleId, tokenHash: digest(label) });
  const accept = (recipient, label) => rpc('select public.admin_accept_invitation($1,$2) result', [users[recipient], digest(label)]);
  const status = (recipient, value) => write('central', null, 'user.membership-status', { userId: users[recipient], branchId: 'ans', status: value });
  const denied = operation => assert.rejects(operation, { code: '42501' });
  const schoolHistory = async () => (await one(`select
    (select to_jsonb(m) from public.branch_memberships m where m.user_id=$1 and m.branch_id='ans') membership,
    (select jsonb_agg(to_jsonb(r) order by r.id) from public.role_assignments r where r.user_id=$1 and r.branch_id='ans') assignments,
    (select branch_id from public.profiles where id=$1) primary_school,
    (select count(*)::int from public.audit_log where actor_id=$1 and action='invitation.accepted') acceptances,
    public.authorization_has_permission($1,'course.edit','branch','ans') can_edit`, [users.retained]));

  await db.query('insert into auth.users(id,email) select * from unnest($1::uuid[],$2::text[])', [Object.values(users), names.map(email)]);
  await db.query("insert into public.branch_memberships(user_id,branch_id) select unnest($1::uuid[]),'ans'", [[users.lead, users.manager, users.mixed, users.retained]]);
  await db.query(`insert into public.role_assignments(user_id,role_definition_id,branch_id) values
    ($1,'central_admin',null), ($2,'legacy_branch_lead_branch','ans'), ($3,'legacy_branch_lead_central',null)`, [users.central, users.lead, users.mixed]);
  for (const user of ['lead', 'manager', 'mixed']) await grant('central', user, 'school_admin');
  await grant('central', 'retained', 'school_editor');
  const custom = await write('central', null, 'role.create', { name: 'School reader', scopeKind: 'branch', permissions: ['member.read'], grantableBySchool: true });

  // These pending invitations were issued by authorized managers on the predecessor schema.
  await invite('lead', 'newcomer', custom.id, 'previous-delegation');
  await invite('lead', 'learner', 'member', 'previous-explicit-member');
  await invite('central', 'retained', null, 'pending-membership');
  await invite('manager', 'retained', 'teacher', 'pending-teacher');
  await grant('central', 'lead', 'school_admin', false);
  await status('retained', 'suspended');
  const history = await schoolHistory();
  assert.equal(history.membership.status, 'suspended');
  assert.equal(history.assignments.length, 1);
  assert.equal(history.can_edit, false);
  const pendingRows = () => db.query('select * from public.admin_invitations order by id').then(result => result.rows);
  const beforeUpgrade = await pendingRows();
  await db.exec(readFileSync(new URL('../supabase/migrations/20261120000100_secure_school_invitations.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await pendingRows(), beforeUpgrade);
  assert.deepEqual(await schoolHistory(), history);

  for (const [signature, service] of [
    ['admin_management_read(uuid,text,text,text,jsonb)', true], ['admin_management_write(uuid,text,text,text,jsonb)', true],
    ['admin_accept_invitation(uuid,text)', true], ['admin_has_nonlegacy_school_delegation(uuid,text)', false],
    ['admin_management_read_before_school_invitations(uuid,text,text,text,jsonb)', false],
    ['admin_management_write_before_school_invitations(uuid,text,text,text,jsonb)', false],
  ]) {
    assert.deepEqual(await one(`select has_function_privilege('anon',$1,'execute') anonymous,
      has_function_privilege('authenticated',$1,'execute') signed_in, has_function_privilege('service_role',$1,'execute') service`, [`public.${signature}`]),
    { anonymous: false, signed_in: false, service });
  }
  for (const label of ['pending-membership', 'pending-teacher']) await denied(() => accept('retained', label));
  await denied(() => accept('newcomer', 'previous-delegation'));
  await denied(() => accept('learner', 'previous-explicit-member'));
  assert.deepEqual(await pendingRows(), beforeUpgrade);
  assert.deepEqual(await schoolHistory(), history);

  assert.deepEqual(await options('lead'), ['teacher']);
  const basic = await invite('lead', 'learner', null, 'new-membership');
  assert.equal(basic.status, 'pending');
  assert.equal('tokenHash' in basic, false);
  await accept('learner', 'new-membership');
  assert.equal((await one('select branch_id from public.profiles where id=$1', [users.learner])).branch_id, 'ans');
  for (const role of [custom.id, 'school_editor', 'member']) {
    await denied(() => grant('lead', 'learner', role));
    await denied(() => invite('lead', 'learner', role, `legacy-${role}`));
  }
  await grant('lead', 'learner', 'teacher');
  await invite('lead', 'newcomer', 'teacher', 'new-teacher');
  assert.deepEqual(await accept('newcomer', 'new-teacher'), { accepted: true, branchId: 'ans' });
  await assert.rejects(() => accept('newcomer', 'new-teacher'), { code: 'P0002' });
  assert.equal((await one("select count(*)::int n from public.role_assignments where user_id=any($1::uuid[]) and role_definition_id='teacher' and branch_id='ans'", [[users.learner, users.newcomer]])).n, 2);

  // An active School Admin can delegate a custom role. A retained assignment cannot
  // qualify a grant after suspension even when another role still permits invitations.
  assert.ok((await options('mixed')).includes(custom.id));
  await invite('mixed', 'learner', custom.id, 'pending-mixed');
  await status('mixed', 'suspended');
  assert.deepEqual(await options('mixed'), ['teacher']);
  await denied(() => grant('mixed', 'learner', custom.id));
  await denied(() => invite('mixed', 'learner', custom.id, 'suspended-issuer'));
  await denied(() => accept('learner', 'pending-mixed'));
  await invite('manager', 'newcomer', custom.id, 'authorized-custom');
  await accept('newcomer', 'authorized-custom');
  await invite('central', 'learner', 'school_admin', 'authorized-school-admin');
  await accept('learner', 'authorized-school-admin');

  const limited = await write('central', null, 'role.create', { name: 'Limited central assigner', scopeKind: 'central',
    permissions: ['admin.access', 'membership.manage', 'role.assignment.branch', 'role.assignment.global'], grantableBySchool: false });
  await write('central', null, 'user.role', { userId: users.limited, branchId: null, roleId: limited.id, enabled: true });
  await denied(() => invite('limited', 'learner', 'school_editor', 'limited-editor'));
  await invite('limited', 'learner', 'member', 'authorized-member');
  await accept('learner', 'authorized-member');

  await invite('central', 'retained', 'teacher', 'other-school', 'vinsmc');
  await accept('retained', 'other-school');
  assert.equal((await schoolHistory()).membership.status, 'suspended');
  await status('retained', 'active');
  await accept('retained', 'pending-teacher');
  assert.equal((await schoolHistory()).can_edit, true);
  console.log('School invitation delegation, outstanding grants, suspension, and RPC privileges passed in disposable PostgreSQL.');
} finally {
  if (db) await db.close();
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}

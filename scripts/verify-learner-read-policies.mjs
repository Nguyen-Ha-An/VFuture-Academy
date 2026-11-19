import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const migration = '20261120000200_secure_learner_read_policies.sql';
const personalTables = [
  'opportunity_interest', 'project_members', 'project_interest', 'skill_evidence',
  'certificates', 'xp_events', 'streaks',
];
const catalogTables = ['resources', 'opportunities', 'projects'];
const readTables = [...personalTables, ...catalogTables, 'profiles', 'user_roles', 'course_version_outline'];
const globalAudience = { scope: 'global' };
const audienceA = { scope: 'branches', branchIds: ['ans'] };
const audienceB = { scope: 'branches', branchIds: ['dewey'] };

const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite, {
    until: migration, seedLegacyFixtures: true, hostedFunctionDefaults: true,
  });
  const { user_id: learner, course_id: legacyCourse, course_version_id: legacyVersion } =
    (await db.query('select user_id, course_id, course_version_id from public.enrollments where not branch_scope_known')).rows[0];
  const admin = (await db.query("select user_id from public.user_roles where role = 'admin'")).rows[0].user_id;
  const peer = randomUUID();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [peer, 'other-learner@example.test']);
  await db.query("update public.profiles set branch_id = 'dewey' where id = $1", [peer]);
  for (const table of readTables) {
    await db.exec(`grant select on public.${table} to authenticated, service_role`);
  }
  await db.exec('grant usage on schema auth to authenticated, service_role');

  async function addOutline(courseId, versionId, version, audience) {
    await db.query(`insert into public.course_version_outline
      (version_id, course_id, outline, meta, access, completion, skills, languages, default_language)
      values ($1, $2, '{}', $3, $4, '{}', '[]', '{en}', 'en')`,
    [versionId, courseId, { label: `${courseId}/${version}` }, audience]);
  }
  async function addCourse(courseId, status, audiences) {
    await db.query('insert into public.courses(id, owner_id, status) values ($1, $2, $3)', [courseId, admin, status]);
    const versions = [];
    for (const [index, audience] of audiences.entries()) {
      const version = index + 1;
      const id = randomUUID();
      await db.query(`insert into public.course_versions(id, course_id, version, manifest, checksum, summary, published_by)
        values ($1, $2, $3, '{}', 'fixture', '{}', $4)`, [id, courseId, version, admin]);
      await addOutline(courseId, id, version, audience);
      versions.push(id);
    }
    await db.query('update public.courses set current_version_id = $2 where id = $1', [courseId, versions.at(-1)]);
    return versions;
  }
  async function enroll(userId, courseId, versionId, status) {
    await db.query('insert into public.enrollments(user_id, course_id, course_version_id, status) values ($1, $2, $3, $4)',
      [userId, courseId, versionId, status]);
  }
  await addOutline(legacyCourse, legacyVersion, 1, audienceB);
  await db.query("update public.courses set status = 'archived' where id = $1", [legacyCourse]);
  const broadened = await addCourse('broadened', 'published', [audienceB, globalAudience, globalAudience]);
  const [schoolVersion] = await addCourse('school-a', 'published', [audienceA]);
  await addCourse('school-b', 'published', [audienceB]);
  const [archivedA] = await addCourse('archived-a', 'archived', [audienceA, globalAudience]);
  const [pinnedB] = await addCourse('pinned-b', 'published', [audienceB, audienceB]);
  const [dropped] = await addCourse('dropped', 'archived', [globalAudience]);
  const [independent] = await addCourse('independent', 'published', [globalAudience]);
  await addCourse('draft', 'draft', [globalAudience]);
  await enroll(peer, 'broadened', broadened[0], 'completed');
  await enroll(learner, 'archived-a', archivedA, 'completed');
  await enroll(learner, 'dropped', dropped, 'dropped');
  await enroll(learner, 'independent', independent, 'active');
  await db.query("update public.profiles set branch_id = 'dewey' where id = $1", [learner]);
  await enroll(learner, 'pinned-b', pinnedB, 'active');
  await db.query("update public.profiles set branch_id = 'ans' where id = $1", [learner]);
  await db.query("delete from public.branch_memberships where user_id = $1 and branch_id = 'ans'", [learner]);
  await db.query("insert into public.branch_memberships(user_id, branch_id) values ($1, 'dewey')", [learner]);

  for (const [id, audience] of [['global', globalAudience], ['school-a', audienceA], ['school-b', audienceB]]) {
    await db.query(`insert into public.resources(id, document, status, owner_id, branch_scope)
      values ($1, '{}', 'published', $2, $3)`, [id, admin, audience]);
    await db.query(`insert into public.opportunities(id, title, organization, type, description, status, branch_scope)
      values ($1, '{}', 'Academy', 'workshop', '{}', 'published', $2)`, [id, audience]);
    await db.query(`insert into public.projects(id, title, summary, status, owner_id, approved, branch_scope)
      values ($1, '{}', '{}', 'showcased', $2, true, $3)`, [id, admin, audience]);
  }
  await db.query(`insert into public.projects(id, title, summary, owner_id, branch_scope)
    values ('own-proposal', '{}', '{}', $1, $2), ('school-proposal', '{}', '{}', $1, $3),
      ('peer-proposal', '{}', '{}', $4, $2)`, [learner, globalAudience, audienceA, peer]);
  await db.exec("insert into public.skills(id, name, category) values ('design', '{}', 'technology')");
  for (const user of [learner, peer]) {
    await db.query("insert into public.opportunity_interest(opportunity_id, user_id) values ('global', $1)", [user]);
    await db.query("insert into public.project_members(project_id, user_id, role) values ('global', $1, 'member')", [user]);
    await db.query("insert into public.project_interest(project_id, user_id) values ('global', $1)", [user]);
    await db.query(`insert into public.skill_evidence(user_id, skill_id, level, evidence_type, ref_type, ref_id)
      values ($1, 'design', 'applied', 'course_completion', 'course', 'school-a')`, [user]);
    await db.query(`insert into public.certificates(user_id, course_id, course_version_id, serial, verification_code)
      values ($1, 'school-a', $2, $3, $4)`, [user, schoolVersion, randomUUID(), randomUUID()]);
    await db.query("insert into public.xp_events(user_id, kind, points, ref_type, ref_id) values ($1, 'course', 1, 'course', 'school-a')", [user]);
    await db.query('insert into public.streaks(user_id) values ($1)', [user]);
  }

  async function asLearner(user, run) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec('set role authenticated');
    try { await run(); }
    finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
  }
  async function assertVisible(table, column, expected) {
    const rows = (await db.query(`select ${column} as value from public.${table} order by 1`)).rows;
    assert.deepEqual(rows.map(row => row.value), expected.toSorted(), table);
  }
  async function assertPersonal(user) {
    for (const table of personalTables) await assertVisible(table, 'user_id', [user]);
    await assertVisible('profiles', 'id', [user]);
  }
  const catalogHelpers = async () => (await db.query(`select public.current_branch_id() as branch,
    public.can_access_course('school-a') as school, public.can_access_course('independent') as global,
    public.can_access_course('archived-a') as archived, public.can_access_course('pinned-b') as foreign`)).rows[0];
  const outline = "meta->>'label'";
  const visibleAtA = ['archived-a/1', 'broadened/3', 'independent/1', `${legacyCourse}/1`, 'pinned-b/1', 'school-a/1'];
  await asLearner(learner, async () => {
    assert.deepEqual(await catalogHelpers(), { branch: 'ans', school: true, global: true, archived: false, foreign: false });
    await assertVisible('course_version_outline', outline, visibleAtA);
    await assertVisible('resources', 'id', ['global', 'school-a']);
    await assertVisible('opportunities', 'id', ['global', 'school-a']);
    await assertVisible('projects', 'id', ['global', 'school-a', 'own-proposal', 'school-proposal']);
    await assertPersonal(learner);
  });
  await asLearner(peer, async () => {
    await assertVisible('course_version_outline', outline, ['broadened/1', 'broadened/3', 'independent/1', 'pinned-b/2', 'school-b/1']);
    await assertPersonal(peer);
  });
  await db.query("insert into public.branch_memberships(user_id, branch_id, status) values ($1, 'ans', 'suspended')", [learner]);
  await asLearner(learner, async () => {
    assert.deepEqual(await catalogHelpers(), { branch: null, school: false, global: true, archived: false, foreign: false });
    await assertVisible('resources', 'id', ['global']);
    await assertVisible('opportunities', 'id', ['global']);
    await assertVisible('projects', 'id', ['global', 'own-proposal']);
    await assertVisible('course_version_outline', outline, ['broadened/3', 'independent/1', `${legacyCourse}/1`, 'pinned-b/1']);
    await assertPersonal(learner);
  });
  await db.query(`update public.branch_memberships set status = case branch_id when 'ans' then 'active' else 'suspended' end
    where user_id = $1`, [learner]);
  await asLearner(learner, () => assertVisible('course_version_outline', outline, visibleAtA.filter(id => id !== 'pinned-b/1')));

  for (const status of ['suspended', 'missing']) {
    if (status === 'suspended') await db.query("update public.user_accounts set status = 'suspended' where user_id = $1", [learner]);
    else await db.query('delete from public.user_accounts where user_id = $1', [learner]);
    await asLearner(learner, async () => {
      assert.deepEqual(await catalogHelpers(), { branch: null, school: false, global: false, archived: false, foreign: false });
      for (const table of readTables) await assertVisible(table, '1', []);
    });
  }
  // The imported role is read-only. Exercise its real owner across suspension.
  await asLearner(admin, () => assertVisible('user_roles', 'user_id', [admin]));
  await db.query("insert into public.role_assignments(user_id, role_definition_id) values ($1, 'central_admin')", [peer]);
  await db.query("update public.user_accounts set status = 'suspended' where user_id = $1", [admin]);
  await asLearner(admin, () => assertVisible('user_roles', 'user_id', []));
  await asLearner(peer, () => assertPersonal(peer));
  await db.exec('set role service_role');
  for (const table of personalTables) await assertVisible(table, 'user_id', [peer, learner]);
  await db.exec('reset role');
  const acl = (await db.query(`select
    has_function_privilege('anon', 'public.current_branch_id()', 'execute') as anonymous_branch,
    has_function_privilege('anon', 'public.can_access_course(text)', 'execute') as anonymous_course,
    has_function_privilege('anon', 'private.learner_can_read_outline(text,uuid)', 'execute') as anonymous_outline,
    has_function_privilege('authenticated', 'private.learner_can_read_outline(text,uuid)', 'execute') as learner_outline,
    has_function_privilege('service_role', 'private.learner_can_read_outline(text,uuid)', 'execute') as service_outline`)).rows[0];
  assert.deepEqual(acl, { anonymous_branch: false, anonymous_course: false, anonymous_outline: false, learner_outline: true, service_outline: false });
  console.log('Learner read policies passed for catalog audiences, pinned editions, school and account suspension, personal ownership, and function grants.');
} finally {
  await db?.close();
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}

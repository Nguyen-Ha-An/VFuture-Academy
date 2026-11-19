import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
let db;
try {
  db = await createFullAdminDatabase(loaded.PGlite, {
    until: '20261120000400_limit_owner_reservations.sql', seedLegacyFixtures: true, hostedFunctionDefaults: true,
  });
  const { user_id: learner, course_version_id: version } = (await db.query('select * from public.enrollments limit 1')).rows[0];
  const sections = [
    { id: 'one', questionIds: ['one/first', 'one/second'], deadlineOffsetMs: null },
    { id: 'two', questionIds: ['two/group'], deadlineOffsetMs: null },
  ];
  async function addAttempt(item, navigation, layout) {
    await db.query("insert into public.course_version_items (version_id,item_id,kind,source,grading,checksum) values ($1,$2,'exam','{}','{}','fixture')", [version, item]);
    const id = randomUUID();
    await db.query(`insert into public.exam_attempts(id,user_id,course_version_id,item_id,attempt_no,question_set,grading_snapshot)
      values($1,$2,$3,$4,1,$5,$6)`, [id, learner, version, item, { sections }, { exam: { navigation, layout } }]);
    return id;
  }
  const serviceCall = (sql, values) => db.transaction(async transaction => {
    await transaction.exec('set local role service_role');
    return (await transaction.query(sql, values)).rows[0].value;
  });
  const save = (id, answers) => serviceCall('select public.exam_save_active_answers($1,$2,$3) value',
    [id, learner, Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer, updatedAt: new Date().toISOString() }))]);
  const advance = (id, from) => serviceCall('select public.exam_advance_sequential_page($1,$2,$3) value', [id, learner, from]);
  const legacy = await addAttempt('legacy-page', 'sequential', 'one_per_page');
  const legacySection = await addAttempt('legacy-section', 'sequential', 'section_per_page');
  const oldReview = await addAttempt('legacy-review', 'sequential', 'one_per_page');
  await save(legacy, { 'one/second': 'retained' });
  await save(legacySection, { 'two/group': { part: 'retained' } });
  await db.query("update public.exam_attempts set status='graded', released_at=now(), percent=88 where id=$1", [oldReview]);
  await db.query("update public.user_accounts set status='suspended' where user_id=$1", [learner]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261120000500_sequential_exam_progress.sql', import.meta.url), 'utf8'));
  for (const id of [legacy, legacySection]) {
    assert.equal((await db.query('select sequential_step from public.exam_attempts where id=$1', [id])).rows[0].sequential_step, 1);
  }
  assert.equal((await db.query('select answer from public.exam_answers where attempt_id=$1', [legacy])).rows[0].answer, 'retained');
  assert.deepEqual((await db.query("select status, released_at is not null as released, percent::integer score from public.exam_attempts where id=$1", [oldReview])).rows[0],
    { status: 'graded', released: true, score: 88 });
  await assert.rejects(() => advance(legacy, 1), { code: '42501' });
  assert.equal((await db.query("select tgenabled from pg_trigger where tgrelid='public.exam_attempts'::regclass and tgname='exam_attempts_require_active_account'")).rows[0].tgenabled, 'O');
  await db.query("update public.user_accounts set status='active' where user_id=$1", [learner]);
  const questions = await addAttempt('per-question', 'sequential', 'one_per_page');
  const section = await addAttempt('per-section', 'sequential', 'section_per_page');
  for (const [id, current, next] of [[questions, 'one/first', 'one/second'], [section, 'one/second', 'two/group']]) {
    assert.equal(await save(id, { [current]: 'accepted' }), true);
    await assert.rejects(() => save(id, { [next]: 'later' }), { code: 'P3004' });
    assert.equal(await advance(id, 0), 1);
    assert.equal(await advance(id, 0), 1);
    await assert.rejects(() => save(id, { [current]: 'previous' }), { code: 'P3004' });
    assert.equal(await save(id, { [next]: 'accepted' }), true);
  }
  assert.equal(await advance(questions, 1), 2);
  assert.deepEqual(await serviceCall('select public.exam_sequential_answered_before($1,$2,$3) value', [questions, learner, 2]), [0, 1]);
  assert.deepEqual(await serviceCall('select public.exam_sequential_answered_before($1,$2,$3) value', [section, learner, 1]), [1]);
  for (const [answer, filled] of [[null, false], ['', false], ['  ', false], [[], false], [{ blank: ' ' }, false], [false, true], [0, true], [{ group: { selected: ['a'] } }, true]]) {
    assert.equal((await db.query('select public.exam_answer_filled($1::jsonb) as filled', [JSON.stringify(answer)])).rows[0].filled, filled);
  }
  await assert.rejects(() => advance(questions, 2), { code: 'P3004' });
  const timed = await addAttempt('timed', 'sequential', 'section_per_page');
  await db.query(`update public.exam_attempts set started_at=now()-interval '10 minutes',
    question_set=jsonb_set(question_set,'{sections,0,deadlineOffsetMs}','60000') where id=$1`, [timed]);
  await assert.rejects(() => save(timed, { 'one/first': 'closed section' }), { code: 'P3007' });
  assert.equal(await advance(timed, 0), 1);
  assert.equal(await save(timed, { 'two/group': { part: 'open section' } }), true);
  await db.query("update public.exam_attempts set deadline_at=now()-interval '31 seconds' where id=$1", [timed]);
  await assert.rejects(() => save(timed, { 'two/group': {} }), { code: 'P3006' });
  await assert.rejects(() => advance(timed, 0), { code: 'P3006' });
  for (const [item, mode, layout] of [['free', 'free', 'one_per_page'], ['whole', 'sequential', 'single_page']]) {
    const id = await addAttempt(item, mode, layout);
    assert.equal(await save(id, { 'one/first': 'a', 'two/group': { part: 'b' } }), true);
    await assert.rejects(() => advance(id, 0), { code: 'P3004' });
  }
  for (const signature of ['public.exam_advance_sequential_page(uuid,uuid,integer)', 'public.exam_sequential_answered_before(uuid,uuid,integer)']) {
    const acl = (await db.query(`select has_function_privilege('anon',$1,'execute') anon,
      has_function_privilege('authenticated',$1,'execute') learner, has_function_privilege('service_role',$1,'execute') service`, [signature])).rows[0];
    assert.deepEqual(acl, { anon: false, learner: false, service: true });
  }
  console.log('Sequential exam progress, retries, saved-page admission and legacy attempts passed in disposable PostgreSQL.');
} finally {
  if (db) await db.close();
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}

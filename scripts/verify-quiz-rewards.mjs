// Exercise the real quiz ledger, streaks and leaderboard in a disposable database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const runtime = process.env.PGLITE_MODULE_PATH;
if (!runtime) throw new Error('Set PGLITE_MODULE_PATH to the local PostgreSQL test runtime');
const { PGlite } = await loadPGlite(runtime);
const db = await createFullAdminDatabase(PGlite, {
  until: '20261106040000_management_teaching_scope.sql', seedLegacyFixtures: true, hostedFunctionDefaults: true,
});
const learner = 'ffffffff-0000-4000-8000-000000000002';
const version = 'ffffffff-0000-4000-8000-000000000010';
const otherVersion = 'ffffffff-0000-4000-8000-000000000011';
const owner = 'ffffffff-0000-4000-8000-000000000001';
const monday = '2026-11-16T04:00:00Z';
const tuesday = '2026-11-17T04:00:00Z';
const wednesday = '2026-11-18T04:00:00Z';
const lesson = 'quiz-lesson';
const status = (questionId, value) => ({ questionId, status: value });
const sequence = new Map();

async function saveAttempt({ answers, results, quiz = 'practice', user = learner, courseVersion = version, item = lesson, date = monday }) {
  const key = [user, courseVersion, item, quiz].join(':');
  const number = (sequence.get(key) ?? 0) + 1;
  sequence.set(key, number);
  const saved = await db.query(`insert into public.quiz_attempts
    (user_id, course_version_id, item_id, quiz_id, attempt_no, answers, results, submitted_at)
    values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) returning id`,
  [user, courseVersion, item, quiz, number, JSON.stringify(answers), JSON.stringify(results), date]);
  return saved.rows[0].id;
}
async function award(attempt, user = learner) {
  await db.exec('set role service_role');
  try {
    return (await db.query('select * from public.xp_record_quiz_submission($1,$2)', [user, attempt])).rows[0];
  } finally {
    await db.exec('reset role');
  }
}
const incorrect = { answers: { choice: false }, results: [status('choice', 'incorrect')] };
const correct = { answers: { score: 0 }, results: [status('score', 'correct')] };
const group = {
  answers: { group: { first: false, 'group/second': 0 } },
  results: [{ ...status('group', 'correct'), children: [status('group/first', 'correct'), status('group/second', 'correct')] }],
};

try {
  await db.query(`insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by)
    values ($1,'migration-access-fixture',2,'{}','quiz-rewards','{}',$2)`, [otherVersion, owner]);
  const grading = {
    questions: { editor: { type: 'code_answer' }, boxes: { type: 'classification', correctAnswer: { first: 'yes' } } },
    quizzes: { practice: { feedback: 'none' } },
  };
  for (const [v, item] of [[version, lesson], [otherVersion, lesson], [version, 'another-lesson']]) {
    await db.query(`insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum)
      values ($1,$2,'lesson','{}',$3,'quiz-rewards')`, [v, item, grading]);
  }
  await db.query('update public.profiles set profile_public = true where id = $1', [learner]);
  const historical = await saveAttempt({ ...incorrect, quiz: 'legacy' });
  await db.query(`insert into public.xp_events (user_id,kind,ref_type,ref_id,points,created_at)
    values ($1,'quiz_submitted','quiz_attempt',$2,5,$3)`, [learner, historical, monday]);
  const completed = Array.from({ length: 8 }, (_, index) => `q${index + 1}`);
  const fullCredit = {
    answers: Object.fromEntries(completed.map(id => [id, 'a'])),
    results: completed.map(id => status(id, 'correct')),
  };
  const oldScope = { quiz: 'older-practice', user: owner };
  for (const date of [monday, tuesday]) {
    const attempt = await saveAttempt({ ...fullCredit, ...oldScope, date });
    await db.query(`insert into public.xp_events(user_id,kind,ref_type,ref_id,points,created_at)
      values($1,'quiz_submitted','quiz_attempt',$2,20,$3)`, [owner, attempt, date]);
  }
  // Match the existing service-role table grants of both supported backends.
  await db.exec(`grant select on public.quiz_attempts,public.course_version_items,public.xp_events,public.streaks to service_role;
    grant insert on public.xp_events to service_role`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261120000700_bound_quiz_rewards.sql', import.meta.url), 'utf8'));

  const roles = await db.query(`select has_function_privilege('service_role', $1, 'execute') as service,
    has_function_privilege('authenticated', $1, 'execute') as authenticated,
    has_function_privilege('anon', $1, 'execute') as anon`, ['public.xp_record_quiz_submission(uuid,uuid)']);
  assert.deepEqual(roles.rows[0], { service: true, authenticated: false, anon: false });
  const blanks = await saveAttempt({
    answers: { editor: { language: 'python', code: '' }, words: ' \t\u00a0', boxes: { first: ' ', unused: 'work' } },
    results: [status('editor', 'self_assessed'), status('words', 'incorrect'), status('boxes', 'incorrect')],
  });
  const noAward = await award(blanks);
  assert.equal(noAward.event_id, null);
  assert.equal(noAward.last_active_date, null);
  const first = await saveAttempt(incorrect);
  assert.equal(Number((await award(first)).points), 5);
  assert.equal((await award(first)).event_id, null);
  assert.equal(Number((await award(await saveAttempt({ ...group, date: tuesday }))).points), 4);
  const practice = await award(await saveAttempt({ ...correct, date: wednesday }));
  assert.equal(practice.event_id, null);
  assert.equal(practice.current_streak, 3);

  const final = await saveAttempt({ ...fullCredit, date: wednesday });
  // A rolling deployment may still submit the old event form.
  const oldWriter = await db.query(`insert into public.xp_events(user_id,kind,ref_type,ref_id,points)
    values ($1,'quiz_submitted','quiz_attempt',$2,20) returning points, quiz_reward_total`, [learner, final]);
  assert.equal(Number(oldWriter.rows[0].points), 11);
  assert.equal(oldWriter.rows[0].quiz_reward_total, 20);
  assert.equal((await award(final)).event_id, null);
  assert.equal(Number((await award(await saveAttempt({ ...group, quiz: 'legacy', date: tuesday }))).points), 4);
  const original = (await db.query('select points,quiz_reward_scope from public.xp_events where ref_id=$1', [historical])).rows[0];
  assert.equal(Number(original.points), 5);
  assert.equal(original.quiz_reward_scope, null);
  assert.equal((await award(await saveAttempt({ ...fullCredit, ...oldScope, date: wednesday }), owner)).event_id, null);
  assert.equal(Number((await db.query('select total_points from public.xp_user_total($1)', [owner])).rows[0].total_points), 40);
  for (const scope of [{ courseVersion: otherVersion }, { item: 'another-lesson' }, { quiz: 'other' }, { user: owner }]) {
    assert.equal(Number((await award(await saveAttempt({ ...correct, ...scope }), scope.user ?? learner)).points), 7);
  }
  const leaderboard = await db.query(`select points from public.xp_weekly_leaderboard('global',null,$1)`, ['2026-11-15T17:00:00Z']);
  assert.equal(Number(leaderboard.rows[0].points), 50);
  const summary = await db.query('select total_points from public.xp_user_total($1)', [learner]);
  assert.equal(Number(summary.rows[0].total_points), 50);

  const sunday = await saveAttempt({ ...correct, date: '2026-11-22T04:00:00Z' });
  assert.equal((await award(sunday)).event_id, null);
  assert.equal((await db.query('select id from public.xp_events where ref_id = $1', [sunday])).rows.length, 0);
  const nextMonday = '2026-11-23T04:00:00Z';
  const retake = await saveAttempt({ ...correct, date: nextMonday });
  await db.exec('set role service_role');
  try {
    // The old .single() writer needs exactly one returned row before it can
    // apply its own idempotent update for the event's original activity date.
    const receipt = await db.query(`insert into public.xp_events(user_id,kind,ref_type,ref_id,points)
      values ($1,'quiz_submitted','quiz_attempt',$2,7) returning id,points,created_at`, [learner, retake]);
    assert.equal(receipt.rows.length, 1);
    assert.ok(receipt.rows[0].id);
    assert.equal(Number(receipt.rows[0].points), 0);
    assert.equal(new Date(receipt.rows[0].created_at).toISOString(), new Date(nextMonday).toISOString());
    const streak = await db.query('select * from public.xp_update_streak($1, ($2::timestamptz at time zone \'Asia/Ho_Chi_Minh\')::date)',
      [learner, receipt.rows[0].created_at]);
    assert.equal(streak.rows[0].current_streak, 2);
    assert.equal(Number((await db.query('select total_points from public.xp_user_total($1)', [learner])).rows[0].total_points), 50);
    const quietWeek = await db.query("select * from public.xp_weekly_leaderboard('global',null,$1)", ['2026-11-22T17:00:00Z']);
    assert.deepEqual(quietWeek.rows, []);
  } finally {
    await db.exec('reset role');
  }
  console.log('Quiz XP earnings, practice, streaks, historical credits and leaderboard totals passed.');
} finally {
  await db.close();
}

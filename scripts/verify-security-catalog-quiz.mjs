import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminTestDatabase, loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

const sql = (name) => readFileSync(join(repositoryRoot, 'supabase/migrations', name), 'utf8');
const migration = '20261007101233_security_active_catalog_and_hidden_quiz_results.sql';
const runtime = await loadPGlite(process.env.PGLITE_MODULE_PATH);
const { db, ids } = await createAdminTestDatabase(runtime.PGlite);
try {
  await db.exec(`
    alter role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    create table public.resources(id text primary key,status text,branch_scope jsonb);
    create table public.opportunities(id text primary key,status text,branch_scope jsonb);
    create table public.projects(id text primary key,status text,branch_scope jsonb,owner_id uuid,published_at timestamptz,created_at timestamptz default now());
    create table public.course_version_items(version_id uuid,item_id text,grading jsonb,primary key(version_id,item_id));
    alter table public.quiz_attempts add id text primary key, add course_version_id uuid,
      add item_id text, add quiz_id text, add results jsonb, add answers jsonb,
      add points numeric, add max_points numeric, add percent numeric, add passed boolean,
      add attempt_no int, add submitted_at timestamptz;
    alter table public.activity_state add id text primary key, add course_version_id uuid,
      add item_id text, add block_id text, add state jsonb, add completed boolean,
      add updated_at timestamptz default now();
    alter table public.resources enable row level security;
    alter table public.opportunities enable row level security;
    alter table public.projects enable row level security;
    alter table public.quiz_attempts enable row level security;
    alter table public.activity_state enable row level security;
    grant select on public.resources,public.opportunities,public.projects,public.quiz_attempts to authenticated;
    grant select on public.activity_state to authenticated;
    grant all on public.resources,public.opportunities,public.projects,public.quiz_attempts,public.course_version_items to service_role;
    grant all on public.activity_state to service_role;
  `);
  const ecosystem = sql('0007_ecosystem.sql');
  await db.exec(ecosystem.match(/create or replace function public.current_branch_id\(\)[\s\S]*?grant execute on function public.current_branch_id\(\) to authenticated;/)[0]);
  for (const name of ['resources', 'opportunities', 'projects']) {
    await db.exec(ecosystem.match(new RegExp(`create policy "published ${name} readable when scoped"[\\s\\S]*?;`))[0]);
  }
  await db.exec(sql('0013_project_approval.sql'));
  await db.exec(sql('0004_learning.sql').match(/create policy "own quiz attempts"[\s\S]*?;/)[0]);
  await db.exec(sql('0004_learning.sql').match(/create policy "own activity state"[\s\S]*?;/)[0]);
  await db.exec(sql('20260906065949_admin_management.sql').match(/create schema if not exists private;[\s\S]*?grant execute on function private.admin_session_active\(\) to authenticated,service_role;/)[0]);
  await db.exec(sql('20260907091000_quiz_attempt_branch_history.sql'));
  const version = '10000000-0000-4000-8000-000000000001';
  const results = [{ questionId: 'group', status: 'partial', points: 1, maxPoints: 2, parts: { secret: 'correct' }, children: [{ questionId: 'child', status: 'incorrect', parts: { key: 'incorrect' }, children: [{ questionId: 'grandchild', parts: { answer: 'correct' }, points: 0 }] }] }, null, 7, 'primitive'];
  const clean = [{ questionId: 'group', status: 'partial', points: 1, maxPoints: 2, children: [{ questionId: 'child', status: 'incorrect', children: [{ questionId: 'grandchild', points: 0 }] }] }, null, 7, 'primitive'];
  const state = { answers: { question: { parts: ['learner', 'draft'] } }, submissions: 3, completed: true, draft: { parts: ['keep'] },
    last: { results, points: 1, maxPoints: 2, percent: 50, passed: false, attemptId: 'old-attempt' }, checks: { group: results[0], empty: null } };
  const cleanState = { ...state, last: { ...state.last, results: clean }, checks: { group: clean[0], empty: null } };
  const policies = { hidden: 'none', per: 'per_question', after: 'after_submit', bad: {}, unknown: 'unexpected', missing: undefined, numeric: 5, null: null };
  for (const [quiz, feedback] of Object.entries(policies)) {
    await db.query('insert into public.course_version_items values ($1,$2,$3)', [version, quiz, { quizzes: { [quiz]: { feedback } } }]);
    await db.query(`insert into public.quiz_attempts(id,user_id,course_version_id,item_id,quiz_id,results,answers,points,max_points,percent,passed,attempt_no,submitted_at)
      values ($1,$2,$3,$1,$1,$4,$5,1,2,50,false,1,'2026-09-01T00:00:00Z')`, [quiz, ids.learner, version, results, { learner: 'own answer' }]);
    await db.query('insert into public.activity_state(id,user_id,course_version_id,item_id,block_id,state,completed) values ($1,$2,$3,$1,$1,$4,true)', [quiz, ids.learner, version, state]);
  }
  await db.query(`insert into public.quiz_attempts(id,user_id,course_version_id,item_id,quiz_id,results,answers,points,max_points,percent,passed,attempt_no,submitted_at)
    values ('legacy-missing',$1,$2,'hidden','hidden',$3,$4,1,2,50,false,1,'2026-09-01T00:00:00Z')`, [ids.teacher, version, results, { learner: 'historic answer' }]);
  await db.query("insert into public.activity_state(id,user_id,course_version_id,item_id,block_id,state,completed) values ('legacy-missing',$1,$2,'hidden','hidden',$3,true),('nonquiz',$4,$2,'hidden','draft',$3,false)", [ids.teacher, version, state, ids.learner]);
  await db.query('delete from public.user_accounts where user_id=$1', [ids.teacher]);
  const legacy = (await db.query('select * from public.quiz_attempts order by id')).rows;
  const legacyActivity = (await db.query('select * from public.activity_state order by id')).rows;
  // A suspended account is essential: the historical write guard must not abort
  // the cleanup or change history while sanitizing old answer-bearing results.
  await db.query("update public.user_accounts set status='suspended' where user_id=$1", [ids.learner]);
  await db.exec(sql(migration));
  const sanitized = (await db.query('select * from public.quiz_attempts order by id')).rows;
  for (let i = 0; i < legacy.length; i++) {
    const expected = ['per', 'after'].includes(legacy[i].id) ? results : clean;
    assert.deepEqual(sanitized[i], { ...legacy[i], results: expected });
  }
  const sanitizedActivity = (await db.query('select * from public.activity_state order by id')).rows;
  for (let i = 0; i < legacyActivity.length; i++) {
    const expected = ['per', 'after', 'nonquiz'].includes(legacyActivity[i].id) ? state : cleanState;
    assert.deepEqual(sanitizedActivity[i], { ...legacyActivity[i], state: expected });
  }
  assert.equal((await db.query("select tgenabled from pg_trigger where tgname='quiz_attempts_require_active_account'")).rows[0].tgenabled, 'O');
  assert.equal((await db.query("select tgenabled from pg_trigger where tgname='activity_state_require_active_account'")).rows[0].tgenabled, 'O');
  await assert.rejects(db.query("update public.quiz_attempts set points=0 where id='hidden'"), /Account is suspended/);
  await assert.rejects(db.query("update public.activity_state set completed=false where id='hidden'"), /Account is suspended/);
  await db.query("update public.user_accounts set status='active' where user_id=$1", [ids.learner]);
  await db.exec('set role service_role');
  // Trigger guards both inserts and attempts to restore answer-bearing history.
  for (const quiz of Object.keys(policies)) {
    await db.query('update public.quiz_attempts set results=$1 where id=$2', [results, quiz]);
    await db.query(`insert into public.quiz_attempts(id,user_id,course_version_id,item_id,quiz_id,results,answers,points,max_points,percent,passed,attempt_no,submitted_at)
      values ($1,$2,$3,$4,$4,$5,$6,1,2,50,false,2,now())`, [`new-${quiz}`, ids.learner, version, quiz, results, { learner: 'own answer' }]);
    const attempts = (await db.query('select results from public.quiz_attempts where quiz_id=$1', [quiz])).rows;
    for (const attempt of attempts) assert.deepEqual(attempt.results, ['per', 'after'].includes(quiz) ? results : clean);
    await db.query('update public.activity_state set state=$1 where id=$2', [state, quiz]);
    await db.query('insert into public.activity_state(id,user_id,course_version_id,item_id,block_id,state,completed) values ($1,$2,$3,$4,$4,$5,true)', [`new-${quiz}`, ids.learner, version, quiz, state]);
    const activities = (await db.query('select state from public.activity_state where block_id=$1', [quiz])).rows;
    for (const activity of activities) assert.deepEqual(activity.state, ['per', 'after'].includes(quiz) ? state : cleanState);
  }
  await db.query("update public.activity_state set state=$1 where id='nonquiz'", [state]);
  assert.deepEqual((await db.query("select state from public.activity_state where id='nonquiz'")).rows[0].state, state);
  await db.exec('reset role');
  // Use the repository audience/ownership policies unchanged, including own drafts.
  for (const table of ['resources', 'opportunities']) {
    await db.query(`insert into public.${table} values ('global','published',$1),('same','published',$2),('wrong','published',$3),('draft','draft',$1)`, [{ scope: 'global' }, { scope: 'branches', branchIds: ['school-a'] }, { scope: 'branches', branchIds: ['school-b'] }]);
  }
  await db.query(`insert into public.projects(id,status,branch_scope,owner_id,approved) values
    ('global','showcased',$1,$4,true),('same','showcased',$2,$4,true),('wrong','showcased',$3,$4,true),('own-draft','idea',$2,$4,false),('other-draft','idea',$2,$5,false)`, [{ scope: 'global' }, { scope: 'branches', branchIds: ['school-a'] }, { scope: 'branches', branchIds: ['school-b'] }, ids.learner, ids.teacher]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.learner]);
  await db.exec('set role authenticated');
  for (const table of ['resources', 'opportunities', 'projects']) {
    assert.deepEqual((await db.query(`select id from public.${table} order by id`)).rows.map(r => r.id), table === 'projects' ? ['global', 'own-draft', 'same'] : ['global', 'same']);
  }
  assert.equal((await db.query('select count(*)::int as total from public.quiz_attempts')).rows[0].total, 16);
  assert.deepEqual((await db.query("select results from public.quiz_attempts where id='hidden'")).rows[0].results, clean);
  assert.deepEqual((await db.query("select state from public.activity_state where id='hidden'")).rows[0].state, cleanState);
  assert.deepEqual((await db.query("select state from public.activity_state where id='nonquiz'")).rows[0].state, state);
  assert.deepEqual((await db.query("select state from public.activity_state where id='after'")).rows[0].state, state);
  await assert.rejects(db.query("select private.quiz_results_without_parts('{}'::jsonb)"), /permission denied/);
  for (const status of ['suspended', 'missing']) {
    await db.exec('reset role');
    if (status === 'missing') await db.query('delete from public.user_accounts where user_id=$1', [ids.learner]);
    else await db.query("update public.user_accounts set status='suspended' where user_id=$1", [ids.learner]);
    await db.exec('set role authenticated');
    for (const table of ['resources', 'opportunities', 'projects']) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows, []);
    }
  }
  await db.exec('reset role; set role service_role');
  for (const [table, count] of [['resources', 4], ['opportunities', 4], ['projects', 5]]) {
    assert.equal((await db.query(`select count(*)::int as total from public.${table}`)).rows[0].total, count);
  }
  assert.deepEqual((await db.query('select private.quiz_results_without_parts($1) as result', [{ parts: { key: 'correct' }, wrapper: [{ parts: {}, score: 3 }], score: 1 }])).rows[0].result, { wrapper: [{ score: 3 }], score: 1 });
  await db.exec('reset role');
  const restrictive = (await db.query("select tablename,permissive from pg_policies where policyname='active_account_required' order by tablename")).rows;
  assert.deepEqual(restrictive, ['opportunities', 'projects', 'resources'].map(tablename => ({ tablename, permissive: 'RESTRICTIVE' })));
  console.log('PASS: catalog RLS, active/suspended/missing accounts, service role, legacy quiz/activity-state backfill, nested results/checks, malformed policies, future inserts/updates, nonquiz drafts and history preservation, helper grants');
} finally {
  await db.close();
  if (runtime.temporaryPrefix) rmSync(runtime.temporaryPrefix, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite, pgcrypto } from '../lib/studio-sql-runtime.mjs';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
`);
for (const name of (await fs.readdir('supabase/migrations')).filter((entry) => entry.endsWith('.sql')).sort()) {
  await db.exec(await fs.readFile(`supabase/migrations/${name}`, 'utf8'));
}

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const learnerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reviewerId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const publisherId = '77777777-7777-4777-8777-777777777777';
const exactHistoryLearnerId = '99999999-9999-4999-8999-999999999999';
const versionV1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const versionV2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const bankVersionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const questionSet = JSON.stringify({
  locale: 'vi', defaultLocale: 'vi',
  sections: [{ id: 'main', questionIds: ['main/q1'], optionOrders: {}, deadlineOffsetMs: null }],
  learner: {
    kind: 'exam', id: 'exam-one', title: 'Bài kiểm tra',
    sections: [{ id: 'main', questions: [{
      id: 'main/q1', type: 'short_answer',
      content: { blocks: [{ type: 'paragraph', content: [{ text: 'Giải thích mô hình này' }] }] },
    }] }],
  },
});
const grading = JSON.stringify({
  questions: {
    'main/q1': {
      id: 'main/q1', type: 'short_answer', points: 10, settings: {},
      interactionType: 'textarea', selfAssessment: false, sourceRef: bankVersionId,
    },
  },
  quizzes: {}, rubrics: {}, assignments: {}, activities: [],
  exam: {
    attemptsAllowed: 2, scoringPolicy: 'best', passPercent: 70,
    timeLimitMinutes: 30, openAt: null, closeAt: null, lateSubmission: 'reject',
    review: { showScore: 'immediately', showCorrectAnswers: 'on_release', showExplanations: 'on_release' },
    shuffleQuestions: false, shuffleOptions: false, navigation: 'free', layout: 'one_per_page',
    integrity: { logFocusLoss: true, logPaste: true },
    sections: [{ id: 'main', questionIds: ['main/q1'], pools: [] }],
  },
});

await db.exec(`
  insert into auth.users(id,email) values
    ('${actorId}','actor@example.test'),('${learnerId}','learner@example.test'),
    ('${reviewerId}','reviewer@example.test'),('${publisherId}','publisher@example.test');
  update public.profiles set branch_id='vinsmc' where id='${learnerId}';
  insert into public.role_definitions(id,name,scope_kind,permissions)
    values
      ('analytics_compat','Analytics compatibility','central',array['analytics.global.read']),
      ('review_only','Review only','central',array['content.review']),
      ('publish_only','Publish only','central',array['content.publish']);
  insert into public.role_assignments(user_id,role_definition_id,branch_id)
    values ('${actorId}','analytics_compat',null),('${reviewerId}','review_only',null),
      ('${publisherId}','publish_only',null);
  insert into public.courses(id,slug,owner_id,status) values ('course-a','course-a','${actorId}','published');
  insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by,published_at) values
    ('${versionV1}','course-a',1,'{}','checksum-v1','{"meta":{"title":{"vi":"Khoá học A"}}}','${actorId}','2026-08-01T00:00:00Z'),
    ('${versionV2}','course-a',2,'{}','checksum-v2','{"meta":{"title":{"vi":"Khoá học A"}}}','${actorId}','2026-08-20T00:00:00Z');
  update public.courses set current_version_id='${versionV2}' where id='course-a';
  insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values
    ('${versionV1}','exam-one','exam','{}','${grading.replaceAll("'", "''")}','exam-v1'),
    ('${versionV2}','exam-one','exam','{}','${grading.replaceAll("'", "''")}','exam-v2'),
    ('${versionV2}','assignment-one','assignment','{}','{"questions":{},"quizzes":{},"rubrics":{},"assignments":{},"activities":[]}','assignment-v2');
  insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values
    ('${versionV1}','course-a','{}','{"title":{"vi":"Khoá học A"}}','{}','{}','[]',array['vi'],'vi'),
    ('${versionV2}','course-a','{}','{"title":{"vi":"Khoá học A"}}','{}','{}','[]',array['vi'],'vi');
  insert into public.enrollments(user_id,course_id,course_version_id,status,enrolled_at,completed_at)
    values ('${learnerId}','course-a','${versionV1}','completed','2026-08-15T03:00:00Z','2026-09-06T03:00:00Z');
  update public.enrollments set course_version_id='${versionV2}' where user_id='${learnerId}' and course_id='course-a';
  alter table public.quiz_attempts disable trigger quiz_attempts_stamp_branch_history;
  insert into public.quiz_attempts(user_id,course_version_id,item_id,quiz_id,attempt_no,answers,results,points,max_points,percent,passed,submitted_at)
    values ('${learnerId}','${versionV1}','exam-one','quiz-one',1,'{}','{}',8,10,80,true,'2026-09-01T03:00:00Z');
  alter table public.quiz_attempts enable trigger quiz_attempts_stamp_branch_history;
  insert into public.exam_attempts(id,user_id,course_version_id,item_id,attempt_no,status,late,question_set,grading_snapshot,started_at,submitted_at,points,max_points,percent,released_at) values
    ('11111111-1111-4111-8111-111111111111','${learnerId}','${versionV2}','exam-one',1,'graded',false,'${questionSet.replaceAll("'", "''")}','${grading.replaceAll("'", "''")}','2026-09-01T01:00:00Z','2026-09-01T02:00:00Z',8,10,80,'2026-09-01T04:00:00Z'),
    ('22222222-2222-4222-8222-222222222222','${learnerId}','${versionV2}','exam-one',2,'pending_manual',false,'${questionSet.replaceAll("'", "''")}','${grading.replaceAll("'", "''")}','2026-09-02T01:00:00Z','2026-09-02T02:00:00Z',4,10,40,null),
    ('33333333-3333-4333-8333-333333333333','${learnerId}','${versionV2}','exam-one',3,'graded',false,'${questionSet.replaceAll("'", "''")}','${grading.replaceAll("'", "''")}','2026-09-03T01:00:00Z','2026-09-03T02:00:00Z',2,10,20,null);
  insert into public.exam_answers(attempt_id,user_id,question_id,answer,result,manual_points,manual_feedback,graded_by) values
    ('11111111-1111-4111-8111-111111111111','${learnerId}','main/q1','"answer"','{"questionId":"main/q1","status":"incorrect","points":0,"maxPoints":10}',0,'null','${actorId}'),
    ('22222222-2222-4222-8222-222222222222','${learnerId}','main/q1','"answer"','{"questionId":"main/q1","status":"pending_manual","points":0,"maxPoints":10}',null,'null',null),
    ('33333333-3333-4333-8333-333333333333','${learnerId}','main/q1','"answer"','{"questionId":"main/q1","status":"incorrect","points":0,"maxPoints":10}',0,'null','${actorId}');
  with snapshot as (
    insert into public.cms_content_snapshots(content_type,content_id,revision_key,checksum,ownership_kind,audience,source,created_by)
    values ('course','course-a','revision-1','review-checksum','central','{}','{}','${actorId}') returning id
  ) insert into public.cms_review_requests(content_type,content_id,snapshot_id,submitted_by)
    select 'course','course-a',id,'${actorId}' from snapshot;
`);

async function report(publication) {
  const result = await db.query(`select public.studio_learning_report(
    '${actorId}'::uuid,null,null,'2026-08-09'::date,'2026-09-07'::date,$1,true
  ) as report`, [publication]);
  return result.rows[0].report;
}

const released = await report('released');
const historicalQuiz = await db.query(`select branch_id,branch_scope_known,branch_scope_source from public.quiz_attempts where course_version_id='${versionV1}'`);
assert.deepEqual(historicalQuiz.rows[0], { branch_id: null, branch_scope_known: false, branch_scope_source: 'unknown' });
assert.equal(released.overview.attempts.quiz, 1);
assert.deepEqual(released.overview.averages.exam, { percent: 80, sampleSize: 1 });
assert.deepEqual(released.overview.passRates.exam, { percent: 100, sampleSize: 1 });
assert.equal(released.questions[0].questionVersionId, bankVersionId);
assert.match(released.questions[0].prompt, /Giải thích mô hình này/);
assert.equal(released.questions[0].gradedAnswers, 1);
assert.equal(released.questions[0].zeroPointRate, 100);

const branchReleased = await db.query(`select public.studio_learning_report(
  '${actorId}'::uuid,'vinsmc',null,'2026-08-09'::date,'2026-09-07'::date,'released',false
) as report`);
assert.equal(branchReleased.rows[0].report.overview.attempts.quiz, 0);

const reviewRows = await db.query(`select public.cms_list_reviews(
  '${reviewerId}'::uuid,'central',null
) as reviews`);
assert.equal(reviewRows.rows[0].reviews.length, 1);
assert.equal(reviewRows.rows[0].reviews[0].content_id, 'course-a');
const publishReviewRows = await db.query(`select public.cms_list_reviews(
  '${publisherId}'::uuid,'central',null
) as reviews`);
assert.equal(publishReviewRows.rows[0].reviews.length, 1);

const all = await report('all');
assert.equal(all.overview.attempts.exam, 3);
assert.deepEqual(all.overview.averages.exam, { percent: 50, sampleSize: 2 });
assert.deepEqual(all.overview.passRates.exam, { percent: 50, sampleSize: 2 });
assert.equal(all.questions[0].gradedAnswers, 2);
assert.equal(all.grading.exams.pendingManualAttempts, 1);
assert.equal(all.grading.exams.pendingManualQuestions, 1);
assert.equal(all.grading.exams.unpublished, 1);

console.log('REPORT RPC FIXTURE PASSED');
await db.close();

// Exercise the real forward backfill ordering: the learner attempts V1, their
// enrollment advances to V2, then 91000 must leave V1 history unknown rather
// than attributing it from the newer enrollment row.
const historyDb = new PGlite({ extensions: { pgcrypto } });
await historyDb.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
`);
const migrationNames = (await fs.readdir('supabase/migrations')).filter((entry) => entry.endsWith('.sql')).sort();
for (const name of migrationNames.filter((entry) => entry < '20260907091000')) {
  await historyDb.exec(await fs.readFile(`supabase/migrations/${name}`, 'utf8'));
}
await historyDb.exec(`
  insert into auth.users(id,email) values
    ('${actorId}','history-actor@example.test'),('${learnerId}','history-learner@example.test'),
    ('${exactHistoryLearnerId}','exact-history@example.test');
  update public.profiles set branch_id='vinsmc' where id in ('${learnerId}','${exactHistoryLearnerId}');
  insert into public.role_definitions(id,name,scope_kind,permissions)
    values ('analytics_history','Analytics history','central',array['analytics.global.read']);
  insert into public.role_assignments(user_id,role_definition_id,branch_id)
    values ('${actorId}','analytics_history',null);
  insert into public.courses(id,slug,owner_id,status) values ('history-course','history-course','${actorId}','published');
  insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by,published_at) values
    ('${versionV1}','history-course',1,'{}','history-v1','{}','${actorId}','2026-08-01T00:00:00Z'),
    ('${versionV2}','history-course',2,'{}','history-v2','{}','${actorId}','2026-08-20T00:00:00Z');
  update public.courses set current_version_id='${versionV2}' where id='history-course';
  insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values
    ('${versionV1}','exam-one','exam','{}','${grading.replaceAll("'", "''")}','history-item-v1'),
    ('${versionV2}','exam-one','exam','{}','${grading.replaceAll("'", "''")}','history-item-v2');
  insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values
    ('${versionV1}','history-course','{}','{}','{}','{}','[]',array['vi'],'vi'),
    ('${versionV2}','history-course','{}','{}','{}','{}','[]',array['vi'],'vi');
  insert into public.enrollments(user_id,course_id,course_version_id,status,enrolled_at) values
    ('${learnerId}','history-course','${versionV1}','active','2026-08-15T03:00:00Z'),
    ('${exactHistoryLearnerId}','history-course','${versionV1}','active','2026-08-16T03:00:00Z');
  insert into public.quiz_attempts(user_id,course_version_id,item_id,quiz_id,attempt_no,answers,results,points,max_points,percent,passed,submitted_at) values
    ('${learnerId}','${versionV1}','exam-one','quiz-one',1,'{}','{}',8,10,80,true,'2026-09-01T03:00:00Z'),
    ('${exactHistoryLearnerId}','${versionV1}','exam-one','quiz-one',1,'{}','{}',9,10,90,true,'2026-09-01T04:00:00Z');
  update public.enrollments set course_version_id='${versionV2}' where user_id='${learnerId}';
`);
for (const name of migrationNames.filter((entry) => entry >= '20260907091000')) {
  await historyDb.exec(await fs.readFile(`supabase/migrations/${name}`, 'utf8'));
}
const historicalRow = await historyDb.query(`select user_id,branch_id,branch_scope_known,branch_scope_source from public.quiz_attempts order by user_id`);
const movedAttempt = historicalRow.rows.find((row) => row.user_id === learnerId);
const exactAttempt = historicalRow.rows.find((row) => row.user_id === exactHistoryLearnerId);
assert.deepEqual(movedAttempt, { user_id: learnerId, branch_id: null, branch_scope_known: false, branch_scope_source: 'unknown' });
assert.deepEqual(exactAttempt, { user_id: exactHistoryLearnerId, branch_id: 'vinsmc', branch_scope_known: true, branch_scope_source: 'enrollment_snapshot' });
const centralHistory = await historyDb.query(`select public.studio_learning_report(
  '${actorId}'::uuid,null,'history-course','2026-08-09'::date,'2026-09-07'::date,'released',true
) report`);
assert.equal(centralHistory.rows[0].report.overview.attempts.quiz, 2);
const branchHistory = await historyDb.query(`select public.studio_learning_report(
  '${actorId}'::uuid,'vinsmc','history-course','2026-08-09'::date,'2026-09-07'::date,'released',false
) report`);
assert.equal(branchHistory.rows[0].report.overview.attempts.quiz, 1);
console.log('HISTORICAL QUIZ BACKFILL FIXTURE PASSED');
await historyDb.close();

#!/usr/bin/env node
//
// Disposable-PostgreSQL verification for migration
// 20260907092000_exam_result_availability.sql.
//
// It runs against a throwaway PGlite instance and never touches a hosted database.
// Supply an installed runtime with PGLITE_MODULE_PATH (or argv[2]) to skip the
// temporary npm install:
//
//   PGLITE_MODULE_PATH=/tmp/vfuture-staff-sql-runtime/node_modules/@electric-sql/pglite \
//     node scripts/verify-exam-result-availability.mjs
//
// What it proves, in the database rather than in a stub:
//   * the column is additive and nullable, so historical rows stay unpublished;
//   * the pre-availability 9-argument finalize signature still works, unchanged, so
//     the running application keeps submitting during migrate-before-deploy and
//     after a rollback to it;
//   * automatic finalization stamps availability inside the grading transition;
//   * a manual draft and a completion share the attempt-row lock, in BOTH
//     interleavings, so a draft can never land on a published attempt;
//   * completion is idempotent, preserves the first timestamp, and aborts when a
//     draft changed underneath it;
//   * completion never sets released_at and release never sets result_available_at;
//   * reporting counts an attempt as published on either timestamp;
//   * every new function is service-role only.

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

const migrationPath = join(
  repositoryRoot, 'supabase', 'migrations', '20260907092000_exam_result_availability.sql',
);
// The legacy answer-key release lives here. It is applied so this harness can prove
// the two timestamps stay independent against the real function, not a stand-in.
const releaseMigrationPath = join(
  repositoryRoot, 'supabase', 'migrations', '0026_atomic_exam_release.sql',
);

const LEARNER = '00000000-0000-4000-8000-000000000001';
const GRADER = '00000000-0000-4000-8000-000000000002';
const VERSION = '00000000-0000-4000-8000-000000000010';
const AUTO = '00000000-0000-4000-8000-000000000021';
const MANUAL = '00000000-0000-4000-8000-000000000022';
const HISTORICAL = '00000000-0000-4000-8000-000000000023';
const LEGACY_CALLER = '00000000-0000-4000-8000-000000000024';
const AT = '2026-09-07T04:00:00.000Z';
const LATER = '2026-09-08T04:00:00.000Z';

/**
 * The migration recreates `studio_learning_report`, which depends on a large slice
 * of the schema. Verifying the report predicate needs only the exam columns it
 * reads, so the report function is exercised through a stand-in carrying the exact
 * predicate the migration installs, extracted from the migration text itself. That
 * keeps this harness honest (the predicate is not retyped) without rebuilding the
 * analytics schema.
 */
function reportPredicates(sql) {
  const found = [...sql.matchAll(
    /attempt\.released_at is not null or attempt\.result_available_at is not null/g,
  )];
  assert.equal(found.length, 2, 'expected both report publication predicates to honour availability');
  assert.match(
    sql,
    /where attempt\.status = 'graded'\s*\n\s*and attempt\.released_at is null and attempt\.result_available_at is null/,
    'expected the unpublished workload counter to honour availability',
  );
  assert.match(
    sql,
    /'sourceHref','\/grading\/queue\?kind=exam/,
    'expected report question drill-through to target the canonical grading queue',
  );
}

async function main(PGlite) {
  const sql = readFileSync(migrationPath, 'utf8');
  reportPredicates(sql);

  const db = new PGlite();
  const one = (text, params = []) => db.query(text, params).then(({ rows }) => rows[0]);
  let checks = 0;
  const check = (label, fn) => { fn(); checks += 1; return label; };

  try {
    // The pre-migration shape of everything the new functions touch.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.profiles(id uuid primary key);
      create table public.exam_attempts(
        id uuid primary key,
        user_id uuid not null references public.profiles(id) on delete cascade,
        course_version_id uuid not null,
        item_id text not null,
        attempt_no int not null check (attempt_no > 0),
        status text not null default 'in_progress'
          check (status in ('in_progress','submitted','submitted_late','graded','pending_manual','expired')),
        late boolean not null default false,
        question_set jsonb not null,
        grading_snapshot jsonb not null,
        started_at timestamptz not null default now(),
        deadline_at timestamptz,
        submitted_at timestamptz,
        points numeric(9,2),
        max_points numeric(9,2),
        percent numeric,
        released_at timestamptz,
        unique (id, user_id),
        unique (user_id, course_version_id, item_id, attempt_no)
      );
      create table public.exam_answers(
        attempt_id uuid not null,
        user_id uuid not null references public.profiles(id) on delete cascade,
        question_id text not null,
        answer jsonb,
        result jsonb,
        manual_points numeric(9,2),
        manual_feedback jsonb,
        graded_by uuid references public.profiles(id) on delete set null,
        updated_at timestamptz not null default now(),
        primary key (attempt_id, question_id),
        foreign key (attempt_id, user_id)
          references public.exam_attempts(id, user_id) on delete cascade
      );
    `);

    const seedAttempt = async (id, status, extra = '') => {
      await db.exec(`
        insert into public.exam_attempts(
          id, user_id, course_version_id, item_id, attempt_no, status,
          question_set, grading_snapshot, started_at, submitted_at, points, max_points, percent${extra ? ', released_at' : ''}
        ) values (
          '${id}', '${LEARNER}', '${VERSION}', 'exam-one',
          ${Number.parseInt(id.slice(-2), 10)}, '${status}',
          '{}'::jsonb, '{}'::jsonb, '2026-09-07T00:00:00Z', '2026-09-07T01:00:00Z',
          8, 12, 66.67${extra ? `, ${extra}` : ''}
        );
      `);
    };

    await db.exec(`insert into public.profiles values ('${LEARNER}'), ('${GRADER}');`);
    // A row that predates the migration entirely: fully graded, never released.
    await seedAttempt(HISTORICAL, 'graded');

    await db.exec(readFileSync(releaseMigrationPath, 'utf8'));
    // Only now does the migration run, exactly as it will in the deploy pipeline.
    await db.exec(sql.slice(0, sql.indexOf('create or replace function public.studio_learning_report(')));

    const historical = await one(
      'select result_available_at, released_at from public.exam_attempts where id = $1', [HISTORICAL],
    );
    check('historical row is untouched', () => {
      assert.equal(historical.result_available_at, null, 'the migration must not backfill availability');
      assert.equal(historical.released_at, null);
    });

    check('column is additive and nullable', () => {
      assert.ok(historical, 'the pre-existing row survived the migration');
    });

    // A result timestamp is only meaningful for a graded attempt.
    await seedAttempt(AUTO, 'in_progress');
    await assert.rejects(
      db.query(
        `update public.exam_attempts set result_available_at = $1 where id = $2`,
        [AT, AUTO],
      ),
      /exam_attempts_result_available_when_graded/,
      'availability on a non-graded attempt must be rejected',
    );
    checks += 1;

    // --- automatic finalization -------------------------------------------
    const finalized = await one(
      `select public.exam_finalize_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result`,
      [AUTO, 'graded', false, '2026-09-07T01:00:00Z', 12, 12, 100, {}, [], AT],
    );
    check('automatic finalization publishes in the grading transition', () => {
      assert.equal(finalized.result.transitioned, true);
      assert.equal(finalized.result.attempt.status, 'graded');
      assert.ok(finalized.result.attempt.result_available_at, 'expected an availability timestamp');
      assert.equal(finalized.result.attempt.released_at, null, 'finalization must not release the key');
    });

    await assert.rejects(
      db.query(
        `select public.exam_finalize_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [AUTO, 'pending_manual', false, '2026-09-07T01:00:00Z', 8, 12, 66.67, {}, [], AT],
      ),
      /invalid exam finalization/,
      'availability must be refused for a non-graded transition',
    );
    checks += 1;

    // Backward compatibility. The pipeline migrates before it replaces the running
    // application, and a rollback puts that application back in front of this
    // schema, so a 9-argument caller must still succeed with its old behaviour.
    await seedAttempt(LEGACY_CALLER, 'in_progress');
    const legacy = await one(
      `select public.exam_finalize_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) result`,
      [LEGACY_CALLER, 'graded', false, '2026-09-07T01:00:00Z', 12, 12, 100, {}, []],
    );
    check('a pre-availability 9-argument caller still finalizes, publishing nothing', () => {
      assert.equal(legacy.result.transitioned, true, 'the legacy signature must still resolve');
      assert.equal(legacy.result.attempt.status, 'graded');
      assert.equal(Number(legacy.result.attempt.points), 12);
      assert.equal(
        legacy.result.attempt.result_available_at, null,
        'a legacy call must not publish a result',
      );
      assert.equal(legacy.result.attempt.released_at, null);
    });

    // And the two signatures resolve unambiguously: the tenth parameter has no
    // default, so neither arity can match the other function.
    const arities = await one(`select count(*)::int count
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname = 'exam_finalize_attempt'`);
    check('both finalize arities coexist without a default', () => {
      assert.equal(arities.count, 2);
    });

    // --- manual drafts and completion -------------------------------------
    await seedAttempt(MANUAL, 'pending_manual');
    const draft = (points, feedback) => one('select public.exam_save_manual_draft($1,$2) accepted', [MANUAL, {
      questionId: 'essay',
      answer: 'A response a human must read.',
      result: { questionId: 'essay', status: 'partial', points, maxPoints: 4 },
      manualPoints: points,
      manualFeedback: { en: feedback },
      gradedBy: GRADER,
      updatedAt: AT,
    }]);

    assert.equal((await draft(1, 'Thin.')).accepted, true, 'a draft is accepted while grading is open');
    assert.equal((await draft(3, 'Good.')).accepted, true, 'a draft must be re-editable');
    checks += 2;
    const redrafted = await one(
      `select manual_points, manual_feedback from public.exam_answers
       where attempt_id = $1 and question_id = 'essay'`, [MANUAL],
    );
    check('a draft overwrites an earlier score', () => {
      assert.equal(Number(redrafted.manual_points), 3);
      assert.deepEqual(redrafted.manual_feedback, { en: 'Good.' });
    });
    const stillPending = await one(
      'select status, points, result_available_at from public.exam_attempts where id = $1', [MANUAL],
    );
    check('a draft publishes nothing', () => {
      assert.equal(stillPending.status, 'pending_manual');
      assert.equal(Number(stillPending.points), 8, 'a draft must not aggregate into the attempt');
      assert.equal(stillPending.result_available_at, null);
    });

    // A completion whose expected snapshot predates the latest draft must abort.
    const staleSnapshot = {
      essay: { answer: 'A response a human must read.', manualPoints: 1 },
    };
    const aborted = await one(
      `select public.exam_complete_manual_grading($1,$2,$3,$4,$5,$6,$7) result`,
      [MANUAL, 11, 12, 91.67, AT, staleSnapshot, []],
    );
    check('completion aborts when a draft moved underneath it', () => {
      assert.equal(aborted.result.answersChanged, true);
      assert.equal(aborted.result.transitioned, false);
      assert.equal(aborted.result.attempt.status, 'pending_manual');
      assert.equal(aborted.result.attempt.result_available_at, null);
    });

    const currentSnapshot = {
      essay: { answer: 'A response a human must read.', manualPoints: 3 },
    };
    const resultRows = [{
      questionId: 'essay',
      answer: 'A response a human must read.',
      result: { questionId: 'essay', status: 'partial', points: 3, maxPoints: 4 },
      manualPoints: 3,
      manualFeedback: { en: 'Good.' },
      gradedBy: GRADER,
      updatedAt: AT,
    }];
    const completed = await one(
      `select public.exam_complete_manual_grading($1,$2,$3,$4,$5,$6,$7) result`,
      [MANUAL, 11, 12, 91.67, AT, currentSnapshot, resultRows],
    );
    check('completion publishes atomically without releasing the key', () => {
      assert.equal(completed.result.transitioned, true);
      assert.equal(completed.result.attempt.status, 'graded');
      assert.equal(Number(completed.result.attempt.points), 11);
      assert.ok(completed.result.attempt.result_available_at);
      assert.equal(completed.result.attempt.released_at, null);
    });

    // Interleaving A: a draft arriving AFTER completion is refused, so the stored
    // score can never disagree with the published total.
    assert.equal((await draft(0, 'Too late.')).accepted, false, 'a draft after completion is refused');
    checks += 1;
    const afterLateDraft = await one(
      `select attempt.points, answer.manual_points
       from public.exam_attempts attempt
       join public.exam_answers answer on answer.attempt_id = attempt.id and answer.question_id = 'essay'
       where attempt.id = $1`, [MANUAL],
    );
    check('the published total still matches the stored score', () => {
      assert.equal(Number(afterLateDraft.points), 11);
      assert.equal(Number(afterLateDraft.manual_points), 3, 'the refused draft must not have been written');
    });

    // Idempotent retry with a later clock keeps the first timestamp.
    const retried = await one(
      `select public.exam_complete_manual_grading($1,$2,$3,$4,$5,$6,$7) result`,
      [MANUAL, 11, 12, 91.67, LATER, currentSnapshot, resultRows],
    );
    check('a retry is idempotent and preserves the first timestamp', () => {
      assert.equal(retried.result.transitioned, false);
      assert.equal(retried.result.answersChanged, false);
      assert.equal(
        retried.result.attempt.result_available_at,
        completed.result.attempt.result_available_at,
      );
    });

    // Interleaving B: a completion racing a completed attempt observes the final
    // state; and the legacy release path stays entirely separate.
    const released = await one(
      'select public.exam_release_attempt($1,$2) result', [MANUAL, LATER],
    );
    check('release and completion never write each other\'s column', () => {
      assert.equal(released.result.transitioned, true);
      assert.ok(released.result.attempt.released_at);
      assert.equal(
        released.result.attempt.result_available_at,
        completed.result.attempt.result_available_at,
        'release must not re-stamp availability',
      );
    });

    // The historical row is still releasable through the legacy operation only.
    const historicalRelease = await one(
      'select public.exam_release_attempt($1,$2) result', [HISTORICAL, AT],
    );
    check('a historical attempt stays on the legacy release path', () => {
      assert.equal(historicalRelease.result.transitioned, true);
      assert.equal(
        historicalRelease.result.attempt.result_available_at, null,
        'the legacy release must not backfill availability',
      );
    });

    // A draft against a non-existent attempt is a refusal, not a crash.
    const unknown = await one(
      'select public.exam_save_manual_draft($1,$2) accepted',
      ['00000000-0000-4000-8000-0000000000ff', { questionId: 'essay', updatedAt: AT }],
    );
    check('an unknown attempt refuses the draft', () => assert.equal(unknown.accepted, false));

    await assert.rejects(
      db.query('select public.exam_save_manual_draft($1,$2)', [MANUAL, { answer: 'x' }]),
      /invalid exam manual draft/,
      'a draft without a question id must be rejected',
    );
    checks += 1;

    // --- reporting publication predicate ---------------------------------
    const publication = await one(`
      select
        count(*) filter (where attempt.released_at is not null or attempt.result_available_at is not null)::int published,
        count(*) filter (where attempt.status = 'graded'
          and attempt.released_at is null and attempt.result_available_at is null)::int unpublished
      from public.exam_attempts attempt
    `);
    check('reporting counts availability or release as published', () => {
      // AUTO (available only), MANUAL (both), HISTORICAL (released only).
      assert.equal(publication.published, 3);
      // The legacy 9-argument finalization published nothing, so it is outstanding
      // exactly like any other graded-but-unreleased attempt.
      assert.equal(publication.unpublished, 1);
    });

    // --- privileges -------------------------------------------------------
    const acl = await one(`select
      has_function_privilege('service_role', 'public.exam_save_manual_draft(uuid,jsonb)', 'execute') draft_service,
      has_function_privilege('authenticated', 'public.exam_save_manual_draft(uuid,jsonb)', 'execute') draft_authenticated,
      has_function_privilege('anon', 'public.exam_save_manual_draft(uuid,jsonb)', 'execute') draft_anon,
      has_function_privilege('service_role', 'public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb)', 'execute') complete_service,
      has_function_privilege('authenticated', 'public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb)', 'execute') complete_authenticated,
      has_function_privilege('anon', 'public.exam_complete_manual_grading(uuid,numeric,numeric,numeric,timestamptz,jsonb,jsonb)', 'execute') complete_anon,
      has_function_privilege('service_role', 'public.exam_finalize_attempt(uuid,text,boolean,timestamptz,numeric,numeric,numeric,jsonb,jsonb,timestamptz)', 'execute') finalize_service,
      has_function_privilege('authenticated', 'public.exam_finalize_attempt(uuid,text,boolean,timestamptz,numeric,numeric,numeric,jsonb,jsonb,timestamptz)', 'execute') finalize_authenticated,
      has_function_privilege('service_role', 'public.exam_finalize_attempt(uuid,text,boolean,timestamptz,numeric,numeric,numeric,jsonb,jsonb)', 'execute') legacy_service,
      has_function_privilege('authenticated', 'public.exam_finalize_attempt(uuid,text,boolean,timestamptz,numeric,numeric,numeric,jsonb,jsonb)', 'execute') legacy_authenticated,
      has_function_privilege('anon', 'public.exam_finalize_attempt(uuid,text,boolean,timestamptz,numeric,numeric,numeric,jsonb,jsonb)', 'execute') legacy_anon
    `);
    check('every new grading function is service-role only', () => {
      assert.ok(acl.draft_service && acl.complete_service && acl.finalize_service);
      assert.ok(!acl.draft_authenticated && !acl.draft_anon);
      assert.ok(!acl.complete_authenticated && !acl.complete_anon);
      assert.ok(!acl.finalize_authenticated);
      // The compatibility overload must be locked down exactly like the rest.
      assert.ok(acl.legacy_service);
      assert.ok(!acl.legacy_authenticated && !acl.legacy_anon);
    });

    console.log(`Exam result availability verification passed (${checks} checks).`);
  } finally {
    await db.close();
  }
}

let temporaryPrefix = null;
try {
  const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH ?? process.env.PGLITE_RUNTIME);
  temporaryPrefix = loaded.temporaryPrefix;
  await main(loaded.PGlite);
} finally {
  if (temporaryPrefix) rmSync(temporaryPrefix, { recursive: true, force: true });
}

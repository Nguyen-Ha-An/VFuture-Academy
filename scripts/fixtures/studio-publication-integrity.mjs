import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from '../lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from '../verify-admin-migrations.mjs';

/** Upgrade a disposable database with an approved review captured by an earlier release. */
export async function verifyStudioPublicationIntegrity(PGlite) {
  const db = await createFullAdminDatabase(PGlite, { until: '20261106040000_management_teaching_scope.sql' });
  const actor = '95000000-0000-4000-8000-000000000001';
  const first = '95000000-0000-4000-8000-000000000011';
  const second = '95000000-0000-4000-8000-000000000012';
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const courseId = 'pin-course';
  const questionId = 'pin-question';
  const pin = version => ({ kind: 'bank_version', id: questionId, revision_key: version, ownership_kind: 'central', owner_branch_id: null });
  try {
    await db.exec(`
      insert into auth.users(id,email) values ('${actor}','reviewer@example.test');
      insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by)
        values ('${actor}','central_admin',null,'${actor}');
      insert into public.bank_questions(id,owner_id,type,status) values ('pin-question','${actor}','single_choice','published');
      insert into public.bank_question_versions(id,question_id,version,payload,renders,grading,created_by)
        values ('${first}','pin-question',1,'{"id":"pin-question","type":"single_choice","tags":[],"label":"Published"}','{}','{}','${actor}'),
               ('${second}','pin-question',2,'{"id":"pin-question","type":"single_choice","tags":[],"label":"Draft"}','{}','{}','${actor}');
      update public.bank_questions set current_version_id='${first}' where id='pin-question';
      insert into public.courses(id,owner_id) values ('pin-course','${actor}');
      insert into public.course_drafts(course_id,manifest) values ('pin-course','{"id":"pin-course","access":{"scope":"global"}}');
      insert into public.course_draft_items(draft_id,item_id,kind,document)
        select id,'exam','exam','{"kind":"exam","id":"exam","sections":[{"id":"s","questions":[{"$ref":"bank:pin-question"}]}]}'
        from public.course_drafts where course_id='pin-course';
    `);

    const { candidate } = await one("select cms_current_snapshot('course',$1) candidate", [courseId]);
    const revision = candidate.revision_key;
    // Model retained data directly so this regression runs only current publication behavior.
    const { id: oldSnapshot } = await one(`insert into cms_content_snapshots
      (content_type,content_id,revision_key,checksum,ownership_kind,audience,source,dependencies,created_by)
      values ('course',$1,$2,encode(digest(($3::jsonb)::text,'sha256'),'hex'),'central',$4,$3,$5,$6) returning id`,
    [courseId, revision, candidate.source, candidate.audience, JSON.stringify([pin(second)]), actor]);
    const { id: oldApproval } = await one(`insert into cms_review_requests
      (content_type,content_id,snapshot_id,submitted_by,status,reviewer_id,decision_note,decided_at)
      values ('course',$1,$2,$3,'approved',$3,'Earlier decision',now()) returning id`, [courseId, oldSnapshot, actor]);
    const { id: historical } = await one(`insert into cms_review_requests
      (content_type,content_id,snapshot_id,submitted_by,status,published_by,published_at)
      values ('course',$1,$2,$3,'published',$3,now()) returning id`, [courseId, oldSnapshot, actor]);
    const { review: bankReview } = await one("select cms_request_review($1,'bank_question',$2,$3,null) review", [actor, questionId, second]);
    await one("select cms_decide_review($1,$2,'approve','Reviewed the new question')", [actor, bankReview.id]);

    await db.exec(readFileSync(resolve(repositoryRoot, 'supabase/migrations/20261120000300_secure_studio_publication.sql'), 'utf8'));
    assert.deepEqual(await one('select status,decision_note from cms_review_requests where id=$1', [oldApproval]),
      { status: 'stale', decision_note: 'Earlier decision' });
    assert.equal((await one('select status from cms_review_requests where id=$1', [historical])).status, 'published');
    assert.equal((await one('select status from cms_review_requests where id=$1', [bankReview.id])).status, 'approved');
    assert.deepEqual((await one('select dependencies from cms_content_snapshots where id=$1', [oldSnapshot])).dependencies, [pin(second)]);

    const request = async () => (await one("select cms_request_review($1,'course',$2,$3,null) review", [actor, courseId, revision])).review;
    const reviewed = await request();
    assert.notEqual(reviewed.snapshot_id, oldSnapshot);
    assert.equal((await request()).id, reviewed.id);
    const { preview } = await one('select cms_get_review_preview($1,$2) preview', [actor, reviewed.id]);
    assert.deepEqual(preview.snapshot.dependencies, [pin(first)]);

    const checklist = { outcomesReviewed: true, answerKeysVerified: true, accessibilityReviewed: true, ageAppropriate: true, linksValid: true, warningsAcknowledged: true };
    const compiled = version => ({
      courseId, checksum: 'course-checksum', outline: {}, meta: {}, access: candidate.audience, completion: {}, skills: [], languages: ['vi'], defaultLanguage: 'vi',
      items: { exam: { kind: 'exam', checksum: 'exam-checksum', source: candidate.source.items.exam, renders: { vi: {} },
        grading: { questions: { 's/pin-question': { id: 's/pin-question', sourceRef: version } } } } },
    });
    const prepare = version => ({
      expectedUpdatedAt: revision, source: candidate.source, manifest: candidate.source.manifest, compiled: compiled(version), checklist,
      report: { summary: {} }, skillDeclarations: [], skillCategory: 'ai', checksum: 'course-checksum',
    });
    const approve = async (review, version) => (await one(
      "select cms_approve_and_publish($1,$2,$3,'Reviewed',$4) result", [actor, review.id, revision, prepare(version)],
    )).result;
    await assert.rejects(() => approve(reviewed, second), /CMS_REVISION_CHANGED/);
    assert.equal((await one('select status from cms_review_requests where id=$1', [reviewed.id])).status, 'pending');

    await one("select cms_decide_review($1,$2,'approve','Checked preview')", [actor, reviewed.id]);
    const separatePublish = version => one(`select studio_publish_version_guarded($1,$2,$3,$4,$5,$6,null,$7,$8,'[]','ai') result`,
      [courseId, candidate.source.manifest, compiled(version), checklist, { summary: {} }, actor,
        { actor_id: actor, action: 'course.publish', target_type: 'course', target_id: courseId }, revision]);
    assert.equal((await separatePublish(second)).result.conflict, true);
    const published = (await separatePublish(first)).result;
    assert.equal(published.conflict, false);
    const { stored } = await one("select grading#>>'{questions,s/pin-question,sourceRef}' stored from course_version_items where version_id=$1", [published.id]);
    assert.equal(stored, preview.snapshot.dependencies[0].revision_key);

    const next = await request();
    assert.equal((await one('select * from studio_bank_publish($1,$2,$3)', [questionId, second, actor])).current_version_id, second);
    assert.equal((await approve(next, first)).status, 'stale');
    const updated = await request();
    assert.notEqual(updated.snapshot_id, next.snapshot_id);
    assert.equal((await approve(updated, second)).status, 'published');

    await one("insert into bank_questions(id,owner_id,type) values ('unpublished-question',$1,'single_choice')", [actor]);
    await one(`insert into bank_question_versions(question_id,version,payload,renders,grading,created_by)
      values ('unpublished-question',1,'{}','{}','{}',$1)`, [actor]);
    await assert.rejects(() => one("select cms_snapshot_dependencies($1,'central',null)", [{ $ref: 'bank:unpublished-question' }]),
      /CMS_BANK_VERSION_NOT_FOUND/);

    const legacyCreate = () => one(`insert into opportunities(id,title,organization,type,description,created_by,branch_scope)
      values ('legacy-create','{}','School','event','{}',$1,'{"scope":"branches","branchIds":["ans"]}')`, [actor]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(legacyCreate, error => error.code === '23502' && error.column === 'ownership_kind');
    }
    assert.deepEqual(await one(`select
      (select count(*)::int from opportunities where id='legacy-create') as drafts,
      (select count(*)::int from audit_log where target_id='legacy-create') as audits`), { drafts: 0, audits: 0 });
    assert.equal((await one(`insert into opportunities(id,title,organization,type,description,created_by,ownership_kind)
      values ('central-opportunity','{}','Academy','event','{}',$1,'central') returning ownership_kind`, [actor])).ownership_kind, 'central');
    assert.deepEqual(await one(`insert into opportunities(id,title,organization,type,description)
      values ('imported-opportunity','{}','Academy','event','{}') returning created_by,ownership_kind,owner_branch_id`),
    { created_by: null, ownership_kind: 'central', owner_branch_id: null });
    await one(`insert into opportunities(id,title,organization,type,description,created_by,ownership_kind,owner_branch_id)
      values ('school-opportunity','{}','School','event','{}',$1,'branch','ans')`, [actor]);
    await assert.rejects(() => one("select cms_assign_ownership($1,'opportunity','school-opportunity','central',null)", [actor]),
      /CMS_OWNERSHIP_ASSIGNMENT_DENIED/);
    assert.deepEqual(await one("select created_by,ownership_kind,owner_branch_id from opportunities where id='school-opportunity'"),
      { created_by: actor, ownership_kind: 'branch', owner_branch_id: 'ans' });
    assert.equal((await one("select count(*)::int n from audit_log where target_id='school-opportunity' and action='content.ownership.assign'")).n, 1);
  } finally { await db.close(); }
}

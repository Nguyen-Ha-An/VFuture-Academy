#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

async function expectFailure(operation, marker) {
  try { await operation(); }
  catch (error) { if (String(error).includes(marker)) return; throw error; }
  throw new Error(`Expected PostgreSQL failure ${marker}`);
}

async function verify(PGlite) {
  const db = await createFullAdminDatabase(PGlite);
  const actor = '90000000-0000-4000-8000-000000000001';
  const contributor = '90000000-0000-4000-8000-000000000002';
  const schoolEditor = '90000000-0000-4000-8000-000000000003';
  const one = (sql, params = []) => db.query(sql, params).then(result => result.rows[0]);
  try {
    await db.exec(`
      insert into auth.users(id,email,raw_user_meta_data) values ('${actor}','cms-admin@example.test','{"full_name":"CMS Admin"}');
      insert into public.user_accounts(user_id,status) values ('${actor}','active') on conflict (user_id) do update set status='active';
      insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by)
      values ('${actor}','central_admin',null,'${actor}');
      insert into auth.users(id,email,raw_user_meta_data) values ('${contributor}','cms-contributor@example.test','{"full_name":"CMS Contributor"}');
      insert into public.user_accounts(user_id,status) values ('${contributor}','active') on conflict (user_id) do update set status='active';
      insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by)
      values ('${contributor}','legacy_contributor_central',null,'${actor}');

      insert into public.courses(id,slug,owner_id,status) values ('cms-course','cms-course','${actor}','draft');
      insert into public.course_drafts(course_id,manifest,updated_by)
      values ('cms-course','{"id":"cms-course","access":{"scope":"global"}}','${actor}');

      insert into public.bank_questions(id,owner_id,type,status,languages)
      values ('cms-bank','${actor}','single_choice','draft','{vi}');
      insert into public.bank_question_versions(question_id,version,payload,renders,grading,created_by)
      values ('cms-bank',1,'{"id":"cms-bank","type":"single_choice","tags":[]}','{}','{}','${actor}');
      insert into public.resources(id,document,status,owner_id,branch_scope)
      values ('legacy-guide','{"id":"legacy-guide","kind":"resource"}','draft','${contributor}','{"scope":"global"}');
      insert into auth.users(id,email,raw_user_meta_data) values ('${schoolEditor}','school-editor@example.test','{"full_name":"School Editor"}');
      insert into public.user_accounts(user_id,status) values ('${schoolEditor}','active') on conflict (user_id) do update set status='active';
      insert into public.branch_memberships(user_id,branch_id,status) values ('${schoolEditor}','ans','active');
      insert into public.role_assignments(user_id,role_definition_id,branch_id,granted_by)
      values ('${schoolEditor}','school_editor','ans','${actor}');
    `);

    await one("select cms_assert_content_access($1,'resource','legacy-guide','content.read')", [contributor]);
    await one("select cms_assert_content_access($1,'resource','legacy-guide','content.edit')", [contributor]);
    await one("select cms_assign_ownership($1,'resource','legacy-guide','central',null)", [contributor]);
    await expectFailure(
      () => one("select cms_assert_content_access($1,'course','cms-course','content.read')", [contributor]),
      'Permission denied',
    );
    const narrowInventory = await one("select cms_list_content($1,'central',null) value", [contributor]);
    if (narrowInventory.value.some(row => row.content_type !== 'resource')
      || !narrowInventory.value.some(row => row.content_id === 'legacy-guide')) {
      throw new Error('Legacy contributor inventory exceeded its resource-only capability');
    }

    await db.exec(`insert into public.resources(id,document,status,owner_id,branch_scope)
      values ('shared-guide','{"id":"shared-guide","title":{"en":"Published title"}}','draft','${actor}','{"scope":"branches","branchIds":["ans"]}')`);
    const sharedCandidate = await one("select cms_current_snapshot('resource','shared-guide') value");
    const sharedRequest = await one("select cms_request_review($1,'resource','shared-guide',$2,null) value", [actor, sharedCandidate.value.revision_key]);
    await one("select cms_decide_review($1,$2,'approve','Shared resource checked')", [actor, sharedRequest.value.id]);
    await one("select cms_publish_review($1,$2)", [actor, sharedRequest.value.id]);
    const sharedLive = await one("select updated_at::text revision from resources where id='shared-guide'");
    await one("select cms_save_content_draft($1,'resource','shared-guide',$2,$3,$4)", [
      actor, sharedLive.revision,
      { document: { id: 'shared-guide', title: { en: 'UNREVIEWED SECRET TITLE' } } },
      { scope: 'branches', branchIds: ['ans'] },
    ]);
    const schoolInventory = await one("select cms_list_content($1,'branch','ans') value", [schoolEditor]);
    const sharedRow = schoolInventory.value.find(row => row.content_id === 'shared-guide');
    assert.ok(sharedRow, 'Shared published resource must appear in the school inventory');
    assert.equal(sharedRow.editable, false, 'Foreign shared resource must remain read-only');
    assert.equal(sharedRow.title.en, 'Published title', 'Inventory must use the immutable published snapshot');
    assert.equal(sharedRow.studio_href, '/app/resources/shared-guide', 'Read-only resource must use its published view');
    assert.ok(!JSON.stringify(sharedRow).includes('UNREVIEWED SECRET TITLE'), 'Foreign draft content must remain private');


    // Every content type canonicalized by the wrapper must preserve foreign
    // published links while an authorized owner can still reach its editor.
    await db.exec(`
      insert into public.opportunities(id,title,organization,type,description,created_by,branch_scope)
      values ('shared-opportunity','{"en":"Published opportunity"}','Fixture organization','event','{"en":"Published description"}','${actor}','{"scope":"branches","branchIds":["ans"]}');
      insert into public.projects(id,title,summary,owner_id,branch_scope)
      values ('shared-project','{"en":"Published project"}','{"en":"Published summary"}','${actor}','{"scope":"branches","branchIds":["ans"]}');
    `);
    for (const [contentType, contentId, table, title] of [
      ['opportunity', 'shared-opportunity', 'opportunities', 'Published opportunity'],
      ['project', 'shared-project', 'projects', 'Published project'],
    ]) {
      const candidate = await one('select cms_current_snapshot($1,$2) value', [contentType, contentId]);
      const requested = await one('select cms_request_review($1,$2,$3,$4,null) value', [actor, contentType, contentId, candidate.value.revision_key]);
      await one("select cms_decide_review($1,$2,'approve','Shared content checked')", [actor, requested.value.id]);
      await one('select cms_publish_review($1,$2)', [actor, requested.value.id]);
      const live = await one(`select updated_at::text revision from public.${table} where id=$1`, [contentId]);
      const draft = structuredClone(candidate.value.source);
      draft.record.title = { en: 'UNREVIEWED SECRET TITLE' };
      await one('select cms_save_content_draft($1,$2,$3,$4,$5,$6)', [
        actor, contentType, contentId, live.revision, draft, { scope: 'branches', branchIds: ['ans'] },
      ]);
      const inventory = await one("select cms_list_content($1,'branch','ans') value", [schoolEditor]);
      const row = inventory.value.find(entry => entry.content_id === contentId);
      assert.ok(row, `Shared ${contentType} must be listed`);
      assert.equal(row.editable, false, `Foreign ${contentType} must remain read-only`);
      assert.equal(row.status, 'published', `Foreign ${contentType} must expose published status`);
      assert.equal(row.title.en, title, `Foreign ${contentType} must use its published title`);
      assert.equal(row.studio_href, `/app/${table}/${contentId}`, `Foreign ${contentType} must retain its learner destination`);
      assert.ok(!JSON.stringify(row).includes('UNREVIEWED SECRET TITLE'), `Foreign ${contentType} draft must remain private`);
    }
    const ownerInventory = await one("select cms_list_content($1,'central',null) value", [actor]);
    for (const [contentType, contentId] of [
      ['resource', 'shared-guide'], ['opportunity', 'shared-opportunity'], ['project', 'shared-project'],
    ]) {
      const row = ownerInventory.value.find(entry => entry.content_id === contentId);
      assert.ok(row, `Editable ${contentType} must be listed for its owner`);
      assert.equal(row.editable, true, `Owner must retain ${contentType} editing access`);
      assert.equal(row.studio_href, `/studio/library?type=${contentType}&id=${contentId}`, `Editable ${contentType} must retain its canonical Studio destination`);
      assert.equal(row.title.en, 'UNREVIEWED SECRET TITLE', `Owner must see its current ${contentType} draft`);
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expectFailure(() => one("select cms_list_content($1,'central',null)", [actor]), 'permission denied');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await expectFailure(() => one("select cms_list_content_unfiltered($1,'central',null)", [actor]), 'permission denied');
    await one("select cms_list_content($1,'central',null)", [actor]);
    await db.exec('reset role');

    const courseCandidate = await one("select cms_current_snapshot('course','cms-course') value");
    await expectFailure(
      () => one(`select studio_publish_version_guarded(
        'cms-course',$1,$2,'{}','{"summary":{}}',$3,null,$4,$5,'[]','ai'
      )`, [
        courseCandidate.value.source.manifest,
        { courseId: 'cms-course', checksum: 'course-sha', items: {}, outline: [], meta: {}, access: { scope: 'global' }, completion: {}, skills: [], languages: ['vi'], defaultLanguage: 'vi' },
        actor,
        { actor_id: actor, action: 'course.publish', target_type: 'course', target_id: 'cms-course', before: {}, after: {} },
        courseCandidate.value.revision_key,
      ]),
      'CMS_APPROVED_REVIEW_REQUIRED',
    );
    const courseRequest = await one("select cms_request_review($1,'course','cms-course',$2,null) value", [actor, courseCandidate.value.revision_key]);
    await one("select cms_decide_review($1,$2,'approve','Course source and learner render checked')", [actor, courseRequest.value.id]);
    const compiled = { courseId: 'cms-course', checksum: 'course-sha', items: {}, outline: [], meta: {}, access: { scope: 'global' }, completion: {}, skills: [], languages: ['vi'], defaultLanguage: 'vi' };
    const coursePublished = await one(`select studio_publish_version_guarded(
      'cms-course',$1,$2,'{}','{"summary":{}}',$3,null,$4,$5,'[]','ai'
    ) value`, [
      courseCandidate.value.source.manifest,
      compiled,
      actor,
      { actor_id: actor, action: 'course.publish', target_type: 'course', target_id: 'cms-course', before: {}, after: {} },
      courseCandidate.value.revision_key,
    ]);
    if (coursePublished.value.conflict || coursePublished.value.checksum !== 'course-sha') throw new Error('Actual reviewed course publisher failed');

    const bankCandidate = await one("select cms_current_snapshot('bank_question','cms-bank') value");
    await expectFailure(
      () => one("select * from studio_bank_publish('cms-bank',$1,$2)", [bankCandidate.value.revision_key, actor]),
      'CMS_APPROVED_REVIEW_REQUIRED',
    );
    const bankRequest = await one("select cms_request_review($1,'bank_question','cms-bank',$2,null) value", [actor, bankCandidate.value.revision_key]);
    await one("select cms_decide_review($1,$2,'approve','Question render and grading checked')", [actor, bankRequest.value.id]);
    const bankPublished = await one("select * from studio_bank_publish('cms-bank',$1,$2)", [bankCandidate.value.revision_key, actor]);
    if (bankPublished.status !== 'published') throw new Error('Actual reviewed bank publisher failed');

    const publications = await one("select count(*)::int count from cms_publications where content_id in ('cms-course','cms-bank')");
    if (publications.count !== 2) throw new Error('Reviewed publishers did not finalize both immutable publication pointers');
  } finally { await db.close(); }
}

async function verifyLegacyBackfill(PGlite) {
  const db = await createFullAdminDatabase(PGlite, { until: '20260906065949_admin_management.sql' });
  const actor = '91000000-0000-4000-8000-000000000001';
  try {
    await db.exec(`
      insert into auth.users(id,email,raw_user_meta_data) values ('${actor}','legacy-publisher@example.test','{"full_name":"Legacy Publisher"}');
      insert into public.resources(id,document,status,owner_id,published_at,branch_scope,updated_at)
      values ('pre-cms-guide','{"id":"pre-cms-guide","title":{"en":"Historical live"}}','published','${actor}',now(),'{"scope":"global"}',now());
    `);
    const migration = readFileSync(resolve(repositoryRoot, 'supabase/migrations/20260906065951_admin_content_review.sql'), 'utf8');
    await db.exec(migration);
    const backfill = await db.query(`select publication.content_id,snapshot.source,review.status
      from cms_publications publication join cms_content_snapshots snapshot on snapshot.id=publication.snapshot_id
      join cms_review_requests review on review.id=publication.review_id
      where publication.content_type='resource' and publication.content_id='pre-cms-guide'`);
    const row = backfill.rows[0];
    if (!row || row.status !== 'published' || row.source.document.title.en !== 'Historical live') {
      throw new Error('Legacy live resource did not receive an immutable publication baseline');
    }
  } finally { await db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
  try {
    await verify(loaded.PGlite);
    await verifyLegacyBackfill(loaded.PGlite);
    console.log('Actual course and bank CMS publication verification passed.');
  } finally {
    if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
  }
}

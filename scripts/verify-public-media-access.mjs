// Ordinary publication fixtures in a disposable PostgreSQL instance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPGlite } from './lib/admin-db-harness.mjs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';

const runtime = process.argv[2] ?? process.env.PGLITE_MODULE_PATH;
if (!runtime) throw new Error('Set PGLITE_MODULE_PATH to the local PostgreSQL test runtime.');
const { PGlite } = await loadPGlite(runtime);
const db = await createFullAdminDatabase(PGlite, {
  until: '20261106040000_management_teaching_scope.sql',
  hostedFunctionDefaults: true,
});
try {
  const owner = '00000000-0000-4000-8000-000000000001';
  const global = { scope: 'global' };
  const branch = { scope: 'branches', branchIds: ['ans'] };
  await db.query("insert into auth.users(id,email) values($1,'media-projection@example.test')", [owner]);
  // The hosted service role already has table SELECT. Reproduce those baseline ACLs locally.
  await db.exec('grant select on public.media_assets, public.projects, public.resources, public.opportunities, public.courses, public.course_version_outline to service_role');

  const assetIds = ['body', 'file', 'poster', 'alternate', 'shared', 'cover', 'next', 'private', 'unlisted', 'branch', 'pending', 'metadata', 'flyer', 'reserved'];
  for (const asset of assetIds) {
    await db.query("insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes) values($1,$2,$3,$4,'image/png',250)", [
      asset, owner, asset === 'private' ? 'notebooks' : 'media', asset + '.png',
    ]);
  }
  const resourceDocument = (id, scope, fields) => ({
    schemaVersion: 1, kind: 'resource', id, languages: ['vi', 'en'], defaultLanguage: 'en',
    title: 'Field guide', summary: 'Reading notes', resourceType: 'guide', branchScope: scope,
    body: { blocks: [{ type: 'paragraph', content: [{ text: 'Notes' }] }] }, ...fields,
  });
  const resource = (id, status, scope, fields) => db.query(
    'insert into public.resources(id,status,branch_scope,document,owner_id) values($1,$2,$3,$4,$5)',
    [id, status, scope, resourceDocument(id, scope, fields), owner],
  );
  const attachment = (assetId) => ({ src: { assetId }, label: 'File' });
  const body = { vi: { blocks: [{ type: 'image', src: { assetId: 'alternate' }, alt: 'Sơ đồ' }] },
    en: { blocks: [{ type: 'callout', variant: 'tip', blocks: [
      { type: 'video', src: { assetId: 'body' }, poster: { assetId: 'poster' } },
    ] }] } };
  await resource('field-guide', 'published', global, {
    body, attachments: ['file', 'private', 'shared'].map(attachment),
    summary: 'A note about {"assetId":"metadata"}',
  });
  await resource('restricted-guide', 'published', branch, { attachments: [attachment('branch')] });
  await resource('unfinished-guide', 'draft', global, { attachments: [attachment('pending')] });

  const project = (id, asset, approved, scope) => db.query(
    "insert into public.projects(id,owner_id,title,summary,approved,branch_scope,cover_asset_id) values($1,$2,'{}','{}',$3,$4,$5)",
    [id, owner, approved, scope, asset],
  );
  await project('recovery-project', 'shared', true, global);
  await project('design-showcase', 'shared', true, global);
  await project('branch-showcase', 'branch', true, branch);
  await project('submitted-project', 'pending', false, global);

  const opportunity = (id, status, scope, description) => db.query(
    "insert into public.opportunities(id,title,organization,type,description,status,branch_scope) values($1,'{}','Academy','workshop',$2,$3,$4)",
    [id, description, status, scope],
  );
  const notice = (assetId) => ({ blocks: [{ type: 'image', src: { assetId }, alt: 'Flyer' }] });
  await opportunity('open-workshop', 'published', global, {
    vi: { blocks: [{ type: 'callout', variant: 'tip', blocks: notice('flyer').blocks }] },
    en: { blocks: [{ type: 'diagram', src: { assetId: 'reserved' }, alt: 'Reserved renderer' }] },
  });
  await opportunity('branch-workshop', 'published', branch, notice('branch'));
  await opportunity('planned-workshop', 'draft', global, notice('pending'));

  const course = 'recovery-course';
  await db.query("insert into public.courses(id,owner_id,status) values($1,$2,'published')", [course, owner]);
  async function edition(version, assetId, access) {
    const { rows: [row] } = await db.query(
      "insert into public.course_versions(course_id,version,manifest,checksum,summary,published_by) values($1,$2,'{}','fixture','{}',$3) returning id",
      [course, version, owner],
    );
    await db.query(`insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language)
      values($1,$2,'{}',$3,$4,'{}','[]',array['en'],'en')`, [row.id, course, { title: 'Field course', cover: { assetId } }, access]);
    return row.id;
  }
  const setCurrent = (id) => db.query('update public.courses set current_version_id=$1 where id=$2', [id, course]);
  const first = await edition(1, 'cover', global);
  await setCurrent(first);

  // Existing publications are usable as soon as the migration commits.
  await db.exec(readFileSync(new URL('../supabase/migrations/20261120000600_index_public_media_references.sql', import.meta.url), 'utf8'));
  const grants = await db.query(`select has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as signed_in,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service, p.prosecdef as definer
    from pg_proc p where p.oid='public.academy_public_media_asset(text,text,text[],text,text,integer)'::regprocedure`);
  assert.deepEqual(grants.rows, [{ anonymous: false, signed_in: false, service: true, definer: false }]);

  async function check(asset, visible, hiddenPrefix = null, hiddenIds = []) {
    await db.exec('set role service_role');
    try {
      const { rows } = await db.query("select * from public.academy_public_media_asset($1,$2,$3::text[],'','',8)", [asset, hiddenPrefix, hiddenIds]);
      assert.equal(rows.length > 0, visible, asset);
      for (const row of rows) {
        assert.deepEqual([row.bucket, row.path, row.size_bytes], ['media', asset + '.png', 250]);
        assert.equal(row.source !== null, ['resource', 'opportunity'].includes(row.source_kind));
      }
    } finally { await db.exec('reset role'); }
  }
  for (const id of ['body', 'file', 'poster', 'alternate', 'shared', 'cover', 'flyer']) await check(id, true);
  for (const id of ['missing', 'unlisted', 'private', 'metadata', 'branch', 'pending', 'next', 'reserved']) await check(id, false);
  await check('cover', false, 'recovery-');
  await check('body', false, 'recovery-', ['field-guide']);
  await check('shared', true, 'recovery-', ['field-guide']);
  await check('shared', false, 'recovery-', ['field-guide', 'design-showcase']);
  await check('flyer', false, 'recovery-', ['open-workshop']);
  let afterKind = '', afterId = '';
  for (const [kind, id] of [['project', 'design-showcase'], ['project', 'recovery-project'], ['resource', 'field-guide']]) {
    const { rows } = await db.query("select source_kind,parent_id from public.academy_public_media_asset('shared',null,'{}',$1,$2,1)", [afterKind, afterId]);
    assert.deepEqual(rows, [{ source_kind: kind, parent_id: id }]);
    afterKind = kind;
    afterId = id;
  }

  const second = await edition(2, 'next', global);
  await check('next', false);
  await setCurrent(second);
  await check('next', true);
  await check('cover', false);
  await db.query("update public.courses set status='archived' where id=$1", [course]);
  await check('next', false);
  const third = await edition(3, 'branch', branch);
  await db.query("update public.courses set status='published',current_version_id=$1 where id=$2", [third, course]);
  await check('branch', false);

  // Apply ordinary live changes under the same publication guard used by the CMS.
  await db.exec("set vfuture.cms_publishing='on'");
  await db.query("update public.resources set document=$1 where id='field-guide'", [
    resourceDocument('field-guide', global, { attachments: [attachment('file')] }),
  ]);
  await check('body', false);
  await check('file', true);
  await check('shared', true, 'recovery-');
  await db.exec("update public.projects set approved=false where id='design-showcase'");
  await check('shared', false, 'recovery-');
  await check('shared', true);
  await db.query("update public.resources set branch_scope=$1 where id='field-guide'", [branch]);
  await check('file', false);
  await db.exec("update public.opportunities set status='archived' where id='open-workshop'");
  await check('flyer', false);
  console.log('Public media publication, visible parents, edition changes, role grants and revocation passed.');
} finally {
  await db.close();
}

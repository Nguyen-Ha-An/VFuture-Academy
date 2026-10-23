#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PGLITE_VERSION = '0.3.14';
const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(repositoryRoot, 'supabase', 'migrations', '20260906065951_admin_content_review.sql');
const workflowMigrationPath = join(repositoryRoot, 'supabase', 'migrations', '20260908224000_studio_workflow_atomic_publish.sql');

function moduleEntry(location) {
  const candidate = resolve(location);
  if (!existsSync(candidate)) throw new Error(`PGlite module location does not exist: ${candidate}`);
  if (candidate.endsWith('.js') || candidate.endsWith('.mjs')) return candidate;
  return require.resolve('@electric-sql/pglite', { paths: [candidate] });
}

async function loadPGlite() {
  const supplied = process.argv[2] ?? process.env.PGLITE_MODULE_PATH;
  if (supplied) {
    const entry = moduleEntry(isAbsolute(supplied) ? supplied : resolve(repositoryRoot, supplied));
    return { PGlite: (await import(pathToFileURL(entry).href)).PGlite, temporaryPrefix: null };
  }
  const temporaryPrefix = await mkdtemp(join(tmpdir(), 'vfuture-cms-pglite-'));
  const installed = spawnSync('npm', ['install', '--prefix', temporaryPrefix, '--no-save', '--ignore-scripts', `@electric-sql/pglite@${PGLITE_VERSION}`], { encoding: 'utf8' });
  if (installed.status !== 0) {
    rmSync(temporaryPrefix, { recursive: true, force: true });
    throw new Error(`Unable to install temporary PGlite runtime: ${installed.stderr.trim() || installed.stdout.trim()}`);
  }
  return { PGlite: (await import(pathToFileURL(moduleEntry(temporaryPrefix)).href)).PGlite, temporaryPrefix };
}

async function expectFailure(operation, marker) {
  try {
    await operation();
  } catch (error) {
    if (String(error).includes(marker)) return;
    throw error;
  }
  throw new Error(`Expected PostgreSQL failure ${marker}`);
}

/** Shared fixture schema for PGlite semantics and native multi-client lock tests. */
export async function initializeCmsReviewFixture(db) {
  const central = '00000000-0000-4000-8000-000000000001';
  const school = '00000000-0000-4000-8000-000000000002';
    await db.exec(`
      create function digest(text,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
      create role anon; create role authenticated; create role service_role;
      create table branches(id text primary key);
      create table profiles(id uuid primary key);
      create table actor_permissions(actor_id uuid, permission text, scope_kind text, branch_id text);
      create function authorization_has_permission(p_actor_user_id uuid, p_permission text, p_scope_kind text, p_branch_id text default null)
      returns boolean language sql stable as $$select exists (select 1 from actor_permissions p where p.actor_id=p_actor_user_id and p.permission=p_permission
        and p.scope_kind=p_scope_kind and p.branch_id is not distinct from p_branch_id)$$;
      create function authorization_assert_actor(p_actor_user_id uuid, p_permission text, p_scope_kind text, p_branch_id text default null)
      returns void language plpgsql as $$ begin
        if not authorization_has_permission(p_actor_user_id,p_permission,p_scope_kind,p_branch_id) then
          raise exception using errcode='42501', message='Permission denied';
        end if;
      end $$;
      create table courses(id text primary key, status text, updated_at timestamptz, current_version_id uuid, ownership_placeholder text);
      create table course_drafts(id uuid primary key default gen_random_uuid(), course_id text unique, manifest jsonb, base_version_id uuid, updated_at timestamptz);
      create table course_draft_items(draft_id uuid, item_id text, document jsonb);
      create table course_versions(id uuid primary key, course_id text, version int, manifest jsonb, checksum text, published_by uuid, published_at timestamptz);
      create table course_version_items(version_id uuid,item_id text,source jsonb,grading jsonb,checksum text);
      create table course_version_outline(version_id uuid,access jsonb);
      create table media_assets(id text primary key, owner_id uuid, bucket text, path text, mime text, size_bytes bigint, alt jsonb, created_at timestamptz default now());
      create table bank_questions(id text primary key, owner_id uuid, type text, tags text[], difficulty text, status text, current_version_id uuid, languages text[], created_at timestamptz, updated_at timestamptz);
      create table bank_question_versions(id uuid primary key default gen_random_uuid(), question_id text, version int, payload jsonb, renders jsonb, grading jsonb, created_by uuid, created_at timestamptz default now());
      create table resources(id text primary key, document jsonb, status text, owner_id uuid, published_at timestamptz, branch_scope jsonb, created_at timestamptz, updated_at timestamptz);
      create table opportunities(id text primary key, title jsonb, organization text, type text, description jsonb, eligibility jsonb, recommended_skills text[], recommended_courses text[], required_courses text[], application_url text, internal_application boolean, open_at timestamptz, close_at timestamptz, start_at timestamptz, end_at timestamptz, location text, online boolean, branch_scope jsonb, status text, featured boolean, published_at timestamptz, created_at timestamptz, updated_at timestamptz);
      create table projects(id text primary key, title jsonb, summary jsonb, status text, output_links jsonb, skills text[], course_ids text[], owner_id uuid, cover_asset_id text, approved boolean, branch_scope jsonb, published_at timestamptz, created_at timestamptz, updated_at timestamptz);
      create table project_members(project_id text, user_id uuid, role text, created_at timestamptz, updated_at timestamptz);
      create table audit_log(id bigserial primary key, actor_id uuid, action text, target_type text, target_id text, before jsonb, after jsonb, branch_id text, at timestamptz default now());
      create table skills(id text primary key, name jsonb, category text, updated_at timestamptz);
      create function studio_publish_version(text,jsonb,jsonb,jsonb,jsonb,uuid,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function studio_publish_version_guarded(text,jsonb,jsonb,jsonb,jsonb,uuid,text,jsonb,timestamptz,jsonb,text) returns jsonb language sql as $$select jsonb_build_object('conflict',false)$$;
      create function studio_save_draft_workspace(text,jsonb,jsonb,uuid,timestamptz,uuid,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function studio_replace_draft_if_current(text,jsonb,jsonb,uuid,timestamptz) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function studio_bank_publish(p_question_id text,p_version_id uuid,p_actor_id uuid)
      returns table(id text,status text,current_version_id uuid) language sql as $$
        update bank_questions set status='published',current_version_id=p_version_id where bank_questions.id=p_question_id returning bank_questions.id,bank_questions.status,bank_questions.current_version_id
      $$;
      create function studio_project_save(jsonb,jsonb,boolean) returns projects language sql as $$select null::projects$$;
      insert into branches values ('ans'),('dewey');
      insert into profiles values ('${central}'),('${school}');
      insert into actor_permissions
      select '${central}', permission, 'central', null from unnest(array['content.read','content.edit','content.review.request','content.review','content.publish','course.publish','bank.publish','resource.publish','opportunity.publish','project.edit']) permission;
      insert into actor_permissions values
        ('${school}','content.read','branch','ans'),('${school}','content.review.request','branch','ans');
    `);
    await db.exec(readFileSync(migrationPath, 'utf8'));
    await db.exec(readFileSync(workflowMigrationPath, 'utf8'));
}

async function verify(PGlite) {
  const db = new PGlite();
  const central = '00000000-0000-4000-8000-000000000001';
  const school = '00000000-0000-4000-8000-000000000002';
  const one = (sql, params = []) => db.query(sql, params).then(result => result.rows[0]);
  try {
    await initializeCmsReviewFixture(db);

    await db.exec(`
      insert into media_assets(id,owner_id,bucket,path,mime,size_bytes,ownership_kind,owner_branch_id)
      values ('asset_dewey','${central}','media','foreign.png','image/png',100,'branch','dewey');
      insert into resources(id,document,status,owner_id,branch_scope,created_at,updated_at,ownership_kind,owner_branch_id)
      values
        ('central-guide','{"id":"central-guide","title":"Guide","notebook":{"mode":"sql","profile":"safe","runtimeVersion":"1","datasetAssetId":"dataset","datasetChecksum":"sha"}}','draft','${central}','{"scope":"global"}',now(),'2026-09-06T01:00:00Z','central',null),
        ('ans-guide','{"id":"ans-guide","attachments":[{"src":{"assetId":"asset_dewey"}}]}','draft','${school}','{"scope":"branches","branchIds":["ans"]}',now(),'2026-09-06T01:00:00Z','branch','ans');
      insert into courses(id,status,updated_at,ownership_kind) values ('notebook-course','draft',now(),'central');
      insert into course_drafts(course_id,manifest,updated_at)
      values ('notebook-course','{"id":"notebook-course","access":{"scope":"global"}}','2026-09-06T01:00:00Z');
      insert into course_draft_items(draft_id,item_id,document)
      select id,'assignment-one','{"id":"assignment-one","kind":"assignment","notebook":{"runtimeMode":"jupyterlite","runtimeProfileId":"python","runtimeProfileVersion":"1"}}'
      from course_drafts where course_id='notebook-course';
    `);

    await expectFailure(
      () => one("select cms_request_review($1,'course','notebook-course',$2,null)", [central, '2026-09-06 01:00:00+00']),
      'CMS_NOTEBOOK_ADAPTER_REQUIRED',
    );
    const notebookReview = await one("select cms_request_review($1,'course','notebook-course',$2,$3) result", [
      central,
      '2026-09-06 01:00:00+00',
      [{ itemId: 'assignment-one', blockId: null, runtimeMode: 'jupyterlite', runtimeProfileId: 'python', runtimeProfileVersion: '1', colabReason: null, assets: [] }],
    ]);
    if (notebookReview.result.status !== 'pending') throw new Error('Location-matched notebook dependencies were not accepted');

    await expectFailure(
      () => one("select cms_request_review($1,'resource','ans-guide',$2,null)", [school, '2026-09-06 01:00:00+00']),
      'CMS_FOREIGN_ASSET',
    );

    const requested = await one("select cms_request_review($1,'resource','central-guide',$2,null) result", [central, '2026-09-06 01:00:00+00']);
    const reviewId = requested.result.id;
    const snapshot = await one('select source from cms_content_snapshots where id=$1', [requested.result.snapshot_id]);
    if (snapshot.source.document.notebook.datasetChecksum !== 'sha') throw new Error('Notebook execution dependencies were not frozen in the snapshot');

    const approved = await one("select cms_decide_review($1,$2,'approve','Self review against rubric') result", [central, reviewId]);
    if (!approved.result.self_review || approved.result.status !== 'approved') throw new Error('Explicit self review was not recorded');
    const published = await one('select cms_publish_review($1,$2) result', [central, reviewId]);
    if (published.result.status !== 'published') throw new Error('Approved snapshot was not published');
    const publishedWorkflow = await one("select cms_get_workflow($1,'resource','central-guide') result", [central]);
    if (publishedWorkflow.result.content.status !== 'published' || publishedWorkflow.result.actions.requestReview) {
      throw new Error('A standalone publication was exposed as a new draft revision');
    }
    const live = await one("select snapshot_id from cms_publications where content_type='resource' and content_id='central-guide'");
    if (!live?.snapshot_id) throw new Error('Live snapshot pointer was not retained');

    const publishedRow = await one("select updated_at::text revision from resources where id='central-guide'");
    const draft = await one("select cms_save_content_draft($1,'resource','central-guide',$2,$3,$4) result", [
      central,
      publishedRow.revision,
      { document: { id: 'central-guide', title: 'Draft changed' } },
      { scope: 'global' },
    ]);
    if (draft.result.live_status !== 'published') throw new Error('Published edit was not stored as a separate draft');
    const draftWorkflow = await one("select cms_get_workflow($1,'resource','central-guide') result", [central]);
    if (draftWorkflow.result.content.status !== 'draft' || !draftWorkflow.result.actions.requestReview) {
      throw new Error('A saved standalone draft was not exposed as a reviewable revision');
    }
    const unchangedLive = await one("select document from resources where id='central-guide'");
    if (unchangedLive.document.title !== 'Guide') throw new Error('Saving a draft changed the active learner row');
    const pointerAfterEdit = await one("select snapshot_id from cms_publications where content_type='resource' and content_id='central-guide'");
    if (pointerAfterEdit.snapshot_id !== live.snapshot_id) throw new Error('Editing a draft replaced the active publication snapshot');
    const draftReview = await one("select cms_request_review($1,'resource','central-guide',$2,null) result", [central, draft.result.revision_key]);
    await one("select cms_decide_review($1,$2,'approve','Draft revision checked')", [central, draftReview.result.id]);
    const preview = await one('select cms_get_review_preview($1,$2) result', [central, draftReview.result.id]);
    if (preview.result.reviewed_source.document.title !== 'Draft changed'
      || preview.result.published_snapshot.source.document.title !== 'Guide') {
      throw new Error('Review preview did not return exact reviewed and historical published snapshots');
    }
    const revisedDraft = await one("select cms_save_content_draft($1,'resource','central-guide',$2,$3,$4) result", [
      central,
      draft.result.revision_key,
      { document: { id: 'central-guide', title: 'Changed again' } },
      { scope: 'branches', branchIds: ['ans'] },
    ]);
    const revisedAudience = await one("select cms_current_snapshot('resource','central-guide')->'audience' audience");
    if (revisedAudience.audience.scope !== 'branches' || revisedAudience.audience.branchIds[0] !== 'ans') {
      throw new Error('Updating an existing draft did not persist its revised audience');
    }
    if (!revisedDraft.result.revision_key) throw new Error('Revised draft did not acknowledge its stored revision');
    const stale = await one('select status from cms_review_requests where id=$1', [draftReview.result.id]);
    if (stale.status !== 'stale') throw new Error('Editing an approved revision did not persist stale review state');

    await db.exec(`
      insert into bank_questions(id,owner_id,type,tags,status,languages,created_at,updated_at,ownership_kind)
      values ('bank-one','${central}','single_choice','{}','draft','{vi}',now(),now(),'central');
      insert into bank_question_versions(question_id,version,payload,renders,grading,created_by)
      values ('bank-one',1,'{"id":"bank-one"}','{}','{}','${central}');
    `);
    const bankVersion = await one("select id from bank_question_versions where question_id='bank-one'");
    await expectFailure(() => one("select * from studio_bank_publish('bank-one',$1,$2)", [bankVersion.id, central]), 'CMS_APPROVED_REVIEW_REQUIRED');

    await db.exec(`
      insert into media_assets(id,owner_id,bucket,path,mime,size_bytes,alt,ownership_kind,owner_branch_id)
      values ('asset_project_cover','${central}','media','cover.png','image/png',42,'{}','central',null);
      insert into projects(id,title,summary,status,output_links,skills,course_ids,owner_id,cover_asset_id,approved,branch_scope,created_at,updated_at,ownership_kind,owner_branch_id)
      values ('project-cover-review','"Project"','"Summary"','active','[]','{}','{}','${central}','asset_project_cover',false,'{"scope":"global"}',now(),'2026-09-06T03:00:00Z','central',null);
    `);
    const projectRevision = await one("select cms_current_snapshot('project','project-cover-review')->>'revision_key' revision");
    const projectReview = await one("select cms_request_review($1,'project','project-cover-review',$2,null) result", [central, projectRevision.revision]);
    const projectDependencies = await one('select dependencies from cms_content_snapshots where id=$1', [projectReview.result.snapshot_id]);
    if (projectDependencies.dependencies[0]?.id !== 'asset_project_cover'
      || projectDependencies.dependencies[0]?.ownership_kind !== 'central') {
      throw new Error('Project cover ownership was not frozen as a review dependency');
    }
    await db.exec("update media_assets set ownership_kind='branch', owner_branch_id='dewey' where id='asset_project_cover'");
    const ownershipChanged = await one("select cms_approve_and_publish($1,$2,$3,'Ownership checked',null) result", [
      central, projectReview.result.id, projectRevision.revision,
    ]);
    if (ownershipChanged.result.status !== 'stale') {
      throw new Error('Dependency ownership reassignment did not stale the reviewed project');
    }
    const projectPublication = await one("select count(*)::int count from cms_publications where content_type='project' and content_id='project-cover-review'");
    if (projectPublication.count !== 0) throw new Error('A project with reassigned cover ownership was published');

    await db.exec(`
      insert into projects(id,title,summary,status,output_links,skills,course_ids,owner_id,approved,branch_scope,created_at,updated_at,ownership_kind,owner_branch_id)
      values ('published-project-delete','"Project"','"Summary"','active','[]','{}','{}','${central}',false,'{"scope":"global"}',now(),'2026-09-06T04:00:00Z','central',null);
    `);
    const deletableRevision = await one("select cms_current_snapshot('project','published-project-delete')->>'revision_key' revision");
    const publishableProject = await one("select cms_request_review($1,'project','published-project-delete',$2,null) result", [central, deletableRevision.revision]);
    const publishedProject = await one("select cms_approve_and_publish($1,$2,$3,'Project reviewed',null) result", [central, publishableProject.result.id, deletableRevision.revision]);
    if (publishedProject.result.status !== 'published') throw new Error('Published-project deletion fixture did not publish');
    const publishedProjectRevision = await one("select cms_current_snapshot('project','published-project-delete')->>'revision_key' revision");
    await expectFailure(
      () => one('select studio_project_delete_guarded($1,$2,$3)', [central, 'published-project-delete', publishedProjectRevision.revision]),
      'PROJECT_PUBLISHED_DELETE_FORBIDDEN',
    );

    const acl = await one(`select
      has_function_privilege('service_role','public.cms_publish_review(uuid,uuid)','execute') service_ok,
      has_function_privilege('authenticated','public.cms_publish_review(uuid,uuid)','execute') authenticated_ok,
      has_function_privilege('service_role','public.studio_publish_version(text,jsonb,jsonb,jsonb,jsonb,uuid,text,jsonb)','execute') raw_course_ok`);
    if (!acl.service_ok || acl.authenticated_ok || acl.raw_course_ok) throw new Error(`CMS function privileges permit a publish bypass: ${JSON.stringify(acl)}`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let temporaryPrefix = null;
  try {
    const loaded = await loadPGlite();
    temporaryPrefix = loaded.temporaryPrefix;
    await verify(loaded.PGlite);
    console.log('Admin CMS PostgreSQL review verification passed.');
  } finally {
    if (temporaryPrefix) rmSync(temporaryPrefix, { recursive: true, force: true });
  }
}

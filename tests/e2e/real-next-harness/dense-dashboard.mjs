import { seedPublishedAuthoringDraft } from './seed.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync,renameSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
import { readLocalManifest } from './manifest.mjs';

export const SYNTHETIC_DENSE_NAME='Synthetic Routing Verification Participant — Central Administrator [VFU-CEN-ADMIN]';
export const DENSE_COURSE_ID='academy-dense-route-fixture';
const version='20000000-0000-4000-8000-000000000049';
const ownerId='10000000-0000-4000-8000-000000000001';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function target(db,manifest){
  assert.equal(manifest.actors.owner.userId,ownerId);
  assert.equal(manifest.courseId,'academy-route-fixture');
  assert.equal((await db.query('select current_database() as name')).rows[0].name,'academy_route_fixture');
  assert.equal((await db.query('show listen_addresses')).rows[0].listen_addresses,'');
  assert.match((await db.query("select current_setting('server_version_num') as version")).rows[0].version,/^17\d{4}$/);
}
async function inspect(db,manifest){
  await target(db,manifest);
  const counts=(await db.query(`select
    (select count(*)::int from public.enrollments where user_id=$1 and status='active') as "activeCourses",
    (select count(*)::int from public.enrollments where user_id=$1 and course_id=$2 and course_version_id=$3 and status='active') as "densePins",
    (select count(*)::int from public.course_version_items where version_id=$3) as "items",
    (select count(*)::int from public.course_version_items where version_id=$3 and kind='lesson') as "lessons",
    (select count(*)::int from public.course_version_items where version_id=$3 and kind='assignment') as "assignments",
    (select count(*)::int from public.course_version_items where version_id=$3 and kind='exam') as "exams",
    (select coalesce(sum(jsonb_array_length(grading->'activities')),0)::int from public.course_version_items where version_id=$3 and kind='lesson') as "embeddedActivities",
    ((select count(*) from public.exam_attempts where user_id=$1)+(select count(*) from public.quiz_attempts where user_id=$1)+(select count(*) from public.assignment_submissions where user_id=$1)+(select count(*) from public.exam_grades where user_id=$1)+(select count(*) from public.grades where user_id=$1))::int as "results",
    (select count(*)::int from public.teaching_announcements where course_id=$2) as "announcements",
    exists(select 1 from public.role_assignments where user_id=$1 and role_definition_id='central_admin' and branch_id is null) as "centralAdmin"
  `,[ownerId,DENSE_COURSE_ID,version])).rows[0];
  assert.deepEqual(counts,{activeCourses:1,densePins:1,items:49,lessons:39,assignments:8,exams:2,embeddedActivities:0,results:0,announcements:0,centralAdmin:true});
  const name=(await db.query("select p.display_name,u.raw_user_meta_data->>'full_name' as identity_name from public.profiles p join academy_identity.users u on u.id=p.id where p.id=$1",[ownerId])).rows[0];
  assert.equal(name.display_name,SYNTHETIC_DENSE_NAME);assert.equal(name.identity_name,SYNTHETIC_DENSE_NAME);
  return{...counts,tasks:counts.assignments+counts.exams,displayNameLength:name.display_name.length,displayNameSha256:hash(name.display_name)};
}
export async function verifyDenseDashboard(manifest){
  const db=createStudioFixtureClient(manifest.postgres);await db.connect();
  try{await db.query('begin read only');const shape=await inspect(db,manifest);await db.query('rollback');return shape;}finally{await db.end();}
}
export async function prepareDenseDashboard(manifestFile){
  const manifest=readLocalManifest(manifestFile);
  if(resolve(manifestFile)!==join(resolve(manifest.runtime),'manifest.json'))throw new Error('Only the owned fixture manifest may be updated');
  const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
  const bundle=join(manifest.runtime,'compiled-dense-seed.mjs');
  await build({entryPoints:[join(repository,'tests/e2e/real-next-harness/compile-seed.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',absWorkingDir:repository,logLevel:'silent'});
  const {compileDenseDashboardSeed}=await import(pathToFileURL(bundle).href);
  const seed=await compileDenseDashboardSeed();
  const db=createStudioFixtureClient(manifest.postgres);await db.connect();
  try{
    await target(db,manifest);await db.query('begin');
    const current=(await db.query("select course_id from public.enrollments where user_id=$1 and status='active' order by course_id",[ownerId])).rows;
    assert.deepEqual(current,[{course_id:manifest.courseId}],'Dense preparation requires the unchanged one-course synthetic owner baseline');
    assert.equal((await db.query('select count(*)::int as n from public.courses where id=$1',[DENSE_COURSE_ID])).rows[0].n,0,'Prepare dense mode only once per disposable fixture');
    const othersBefore=(await db.query('select user_id,status from public.enrollments where course_id=$1 and user_id<>$2 order by user_id',[manifest.courseId,ownerId])).rows;
    const c=seed.compiled;
    await db.query("insert into public.courses(id,slug,owner_id,status) values($1,$1,$2,'published')",[c.courseId,ownerId]);
    await db.query('insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,$2,1,$3,$4,$5,$6)',[version,c.courseId,seed.workspace.manifest,c.checksum,{courseId:c.courseId,checksum:c.checksum,meta:c.meta,outline:c.outline,languages:c.languages,defaultLanguage:c.defaultLanguage},ownerId]);
    await db.query('update public.courses set current_version_id=$2 where id=$1',[c.courseId,version]);
    await db.query('insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[version,c.courseId,c.outline,c.meta,c.access,c.completion,JSON.stringify(c.skills),c.languages,c.defaultLanguage]);
    for(const item of Object.values(c.items)){
      await db.query('insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values($1,$2,$3,$4,$5,$6)',[version,item.id,item.kind,seed.workspace.items[item.id],item.grading,item.checksum]);
      for(const [locale,payload] of Object.entries(item.renders))await db.query('insert into public.course_version_item_renders(version_id,item_id,locale,payload) values($1,$2,$3,$4)',[version,item.id,locale,payload]);
    }
    await seedPublishedAuthoringDraft(db,{workspace:seed.workspace,versionId:version,actorId:ownerId});
    const dropped=await db.query("update public.enrollments set status='dropped' where user_id=$1 and course_id=$2 and status='active' returning id",[ownerId,manifest.courseId]);assert.equal(dropped.rowCount,1);
    await db.query("insert into public.enrollments(user_id,course_id,course_version_id,status) values($1,$2,$3,'active')",[ownerId,c.courseId,version]);
    await db.query('update public.profiles set display_name=$2 where id=$1',[ownerId,SYNTHETIC_DENSE_NAME]);
    await db.query("update academy_identity.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('full_name',$2::text) where id=$1",[ownerId,SYNTHETIC_DENSE_NAME]);
    const shape=await inspect(db,manifest);
    assert.deepEqual((await db.query('select user_id,status from public.enrollments where course_id=$1 and user_id<>$2 order by user_id',[manifest.courseId,ownerId])).rows,othersBefore,'Other actors retain the original course for the positive HTTP flow');
    await db.query('commit');
    const denseProfile={kind:'synthetic-central-admin-as-learner',actor:'owner',courseId:DENSE_COURSE_ID,versionId:version,checksum:c.checksum,shape};
    const receipt=join(manifest.runtime,'dense-dashboard-preparation.json');writeFileSync(receipt,JSON.stringify(denseProfile,null,2)+'\n',{mode:0o600});
    const next={...manifest,denseProfile:{...denseProfile,receipt}};
    const temp=manifestFile+'.dense.tmp';writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,manifestFile);
    return{status:'synthetic_dense_dashboard_prepared',manifest:manifestFile,receipt,shape};
  }catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{await db.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await prepareDenseDashboard(resolve(process.argv[2]))));}
  catch(error){console.error(JSON.stringify({status:'synthetic_dense_prepare_failed',message:String(error.message).replaceAll(SYNTHETIC_DENSE_NAME,'[synthetic-dense-profile]')}));process.exitCode=1;}
}

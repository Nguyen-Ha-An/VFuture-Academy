import { createHash,randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const FIXTURE_DATABASE='academy_route_fixture';
/** Retain the compiler source needed by the real CMS reader. Fixture
 * preparation is not evidence that the publication API executed. */
export async function seedPublishedAuthoringDraft(db,{workspace,versionId,actorId}){
  if((await db.query('select current_database() as name')).rows[0].name!==FIXTURE_DATABASE)throw new Error('Refusing non-fixture authoring preparation');
  const draft=(await db.query('insert into public.course_drafts(course_id,manifest,base_version_id,updated_by) values($1,$2,$3,$4) returning id',[workspace.manifest.id,workspace.manifest,versionId,actorId])).rows[0];
  for(const [id,item] of Object.entries(workspace.items))await db.query('insert into public.course_draft_items(draft_id,item_id,kind,document,updated_by) values($1,$2,$3,$4,$5)',[draft.id,id,item.kind,item,actorId]);
  await db.query('select public.cms_current_snapshot($1,$2)',['course',workspace.manifest.id]);
}
export async function seedRoutingDatabase(db,{repository,runtime,production=false}){
  if((await db.query('select current_database() as name')).rows[0].name!==FIXTURE_DATABASE)throw new Error('Refusing non-fixture seed target');
  const bundle=join(runtime,'compiled-seed.mjs');
  await build({entryPoints:[join(repository,'tests/e2e/real-next-harness/compile-seed.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',absWorkingDir:repository,logLevel:'silent'});
  const {compileRoutingSeed}=await import(pathToFileURL(bundle).href);
  const seed=await compileRoutingSeed();
  const ids={owner:'10000000-0000-4000-8000-000000000001',learner:'10000000-0000-4000-8000-000000000002',other:'10000000-0000-4000-8000-000000000003',suspended:'10000000-0000-4000-8000-000000000004'};
  const versionId='20000000-0000-4000-8000-000000000001';
  const branch='routing-fixture';
  await db.query('begin');
  try{
    await db.query('insert into public.branches(id,name) values($1,$2)',[branch,'Synthetic routing school']);
    for(const [name,id] of Object.entries(ids)){
      await db.query('insert into academy_identity.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${name}@routing.example.test`,{full_name:`Routing ${name}`}]);
      await db.query("update public.profiles set locale='en',branch_id=$2 where id=$1",[id,branch]);
      await db.query("insert into public.branch_memberships(user_id,branch_id,status) values($1,$2,'active')",[id,branch]);
      await db.query('insert into public.role_assignments(user_id,role_definition_id,branch_id) values($1,$2,$3)',[id,name==='owner'?'central_admin':'member',name==='owner'?null:branch]);
    }
    const compiled=seed.compiled;
    const summary={courseId:compiled.courseId,checksum:compiled.checksum,meta:compiled.meta,outline:compiled.outline,languages:compiled.languages,defaultLanguage:compiled.defaultLanguage};
    await db.query("insert into public.courses(id,slug,owner_id,status) values($1,$1,$2,'published')",[compiled.courseId,ids.owner]);
    await db.query('insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,$2,1,$3,$4,$5,$6)',[versionId,compiled.courseId,seed.workspace.manifest,compiled.checksum,summary,ids.owner]);
    await db.query('update public.courses set current_version_id=$2 where id=$1',[compiled.courseId,versionId]);
    await db.query('insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[versionId,compiled.courseId,compiled.outline,compiled.meta,compiled.access,compiled.completion,JSON.stringify(compiled.skills),compiled.languages,compiled.defaultLanguage]);
    for(const item of Object.values(compiled.items)){
      await db.query('insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values($1,$2,$3,$4,$5,$6)',[versionId,item.id,item.kind,seed.workspace.items[item.id],item.grading,item.checksum]);
      for(const [locale,payload] of Object.entries(item.renders))await db.query('insert into public.course_version_item_renders(version_id,item_id,locale,payload) values($1,$2,$3,$4)',[versionId,item.id,locale,payload]);
    }
    await seedPublishedAuthoringDraft(db,{workspace:seed.workspace,versionId,actorId:ids.owner});
    for(const id of Object.values(ids))await db.query("insert into public.enrollments(user_id,course_id,course_version_id,status) values($1,$2,$3,'active')",[id,compiled.courseId,versionId]);
    await db.query("update public.branch_memberships set status='suspended' where user_id=$1 and branch_id=$2",[ids.suspended,branch]);
    const actors={};
    for(const name of [...Object.keys(ids),'expired']){
      const userId=ids[name]??ids.learner;
      const token=randomBytes(32).toString('base64url');
      const expires=new Date(Date.now()+(name==='expired'?-1:8)*3600000);
      await db.query('insert into academy_identity.sessions(token_hash,user_id,provider,issuer,subject,oidc_subject,expires_at,token_expires_at,refresh_ciphertext) values($1,$2::uuid,$3,$4,$2::uuid,$2::text,$5,$6,null)',[createHash('sha256').update(token).digest('hex'),userId,'external-id','https://localhost:4452/fixture-identity',expires,new Date(Date.now()+4*3600000)]);
      actors[name]={userId,cookie:{name:production?'__Host-academy_session':'academy_session',value:token,httpOnly:true,secure:production,sameSite:'Lax',path:'/'},expiresAt:expires.toISOString()};
    }
    await db.query('commit');
    return {courseId:compiled.courseId,itemId:seed.itemId,versionId,branch,actors,answers:seed.answers,groupId:seed.groupId,questionTypes:seed.questionTypes};
  }catch(error){await db.query('rollback');throw error;}
}

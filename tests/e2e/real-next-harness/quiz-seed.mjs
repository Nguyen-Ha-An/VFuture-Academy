import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { seedPublishedAuthoringDraft } from './seed.mjs';

const FIXTURE_DATABASE = 'academy_route_fixture';
const FIXTURE_VERSION = '20000000-0000-4000-8000-000000000003';

/**
 * Seed only the disposable real-Next harness database. Existing fixture actors
 * are supplied by the launcher; no auth state or activity data is manufactured.
 * Returns the compiler-derived root/leaf IDs used by the real renderer.
 */
export async function seedQuizUploadFixture(db, { repository, runtime, ownerId, learnerId }) {
  if ((await db.query('select current_database() as name')).rows[0].name !== FIXTURE_DATABASE) throw new Error('Refusing non-fixture seed target');
  if (ownerId !== '10000000-0000-4000-8000-000000000001' || learnerId !== '10000000-0000-4000-8000-000000000002') throw new Error('Unexpected synthetic fixture actors');
  const bundle = join(runtime, 'compiled-quiz-upload-seed.mjs');
  await build({ entryPoints: [join(repository, 'tests/e2e/real-next-harness/compile-quiz-seed.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', absWorkingDir: repository, logLevel: 'silent' });
  const { compileQuizUploadSeed } = await import(pathToFileURL(bundle).href);
  const seed = await compileQuizUploadSeed();
  const compiled = seed.compiled;
  const summary = { courseId: compiled.courseId, checksum: compiled.checksum, meta: compiled.meta, outline: compiled.outline, languages: compiled.languages, defaultLanguage: compiled.defaultLanguage };
  await db.query('begin');
  try {
    await db.query("insert into public.courses(id,slug,owner_id,status) values($1,$1,$2,'published')", [compiled.courseId, ownerId]);
    await db.query('insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,$2,1,$3,$4,$5,$6)', [FIXTURE_VERSION, compiled.courseId, seed.workspace.manifest, compiled.checksum, summary, ownerId]);
    await db.query('update public.courses set current_version_id=$2 where id=$1', [compiled.courseId, FIXTURE_VERSION]);
    await db.query('insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [FIXTURE_VERSION, compiled.courseId, compiled.outline, compiled.meta, compiled.access, compiled.completion, JSON.stringify(compiled.skills), compiled.languages, compiled.defaultLanguage]);
    for (const item of Object.values(compiled.items)) {
      await db.query('insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values($1,$2,$3,$4,$5,$6)', [FIXTURE_VERSION, item.id, item.kind, seed.workspace.items[item.id], item.grading, item.checksum]);
      for (const [locale, payload] of Object.entries(item.renders)) await db.query('insert into public.course_version_item_renders(version_id,item_id,locale,payload) values($1,$2,$3,$4)', [FIXTURE_VERSION, item.id, locale, payload]);
    }
    await seedPublishedAuthoringDraft(db,{workspace:seed.workspace,versionId:FIXTURE_VERSION,actorId:ownerId});
    await db.query("insert into public.enrollments(user_id,course_id,course_version_id,status) values($1,$2,$3,'active')", [learnerId, compiled.courseId, FIXTURE_VERSION]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return { ...seed.locator, versionId: FIXTURE_VERSION, practiceLocator: seed.practiceLocator };
}

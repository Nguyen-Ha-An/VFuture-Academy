import { seedPublishedAuthoringDraft } from './seed.mjs';
import { createHash } from 'node:crypto';
import { chmodSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
import { readLocalManifest } from './manifest.mjs';

export const BUDGET_COURSE_ID = 'academy-budget-route-fixture';
export const BUDGET_ITEM_ID = 'budget-exam';
const VERSION_ID = '20000000-0000-4000-8000-000000000200';
const OTHER_ID = '10000000-0000-4000-8000-000000000003';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function requireBudget(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
export function budgetManifest(file, prepared = true) {
  const manifest = readLocalManifest(file);
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  requireBudget(dirname(resolve(manifest.runtime)) === join(repository, 'build/azure-core/private')
    && /^routing-next-[A-Za-z0-9]+$/.test(basename(manifest.runtime)), 'BUDGET_OWNED_RUNTIME');
  requireBudget(resolve(file) === join(resolve(manifest.runtime), 'manifest.json'), 'BUDGET_MANIFEST_LOCATION');
  requireBudget(realpathSync(file) === resolve(file)
    && resolve(manifest.ca) === join(resolve(manifest.runtime), 'ca.crt'), 'BUDGET_PRIVATE_PATHS');
  requireBudget(manifest.actors.other?.userId === OTHER_ID && manifest.actors.owner?.userId !== OTHER_ID
    && manifest.actors.learner?.userId !== OTHER_ID, 'BUDGET_OTHER_ACTOR_ONLY');
  requireBudget(manifest.courseId === 'academy-route-fixture', 'BUDGET_BASELINE_MANIFEST');
  if (prepared) requireBudget(manifest.budgetFixture?.courseId === BUDGET_COURSE_ID
    && manifest.budgetFixture.itemId === BUDGET_ITEM_ID && manifest.budgetFixture.versionId === VERSION_ID
    && manifest.budgetFixture.actor === 'other' && manifest.budgetFixture.simpleQuestionIds?.length === 199
    && manifest.budgetFixture.groupChildQuestionIds?.length === 2, 'BUDGET_PREPARATION_REQUIRED');
  return manifest;
}
export async function assertBudgetDatabase(db, manifest) {
  requireBudget((await db.query('select current_database() name')).rows[0].name === 'academy_route_fixture', 'BUDGET_DATABASE');
  requireBudget((await db.query('show listen_addresses')).rows[0].listen_addresses === '', 'BUDGET_SOCKET_ONLY');
  requireBudget(/^17\d{4}$/.test((await db.query("select current_setting('server_version_num') version")).rows[0].version), 'BUDGET_POSTGRES_VERSION');
  const membership = await db.query("select status from public.branch_memberships where user_id=$1 and branch_id=$2", [OTHER_ID, manifest.branch]);
  requireBudget(membership.rows.length === 1 && membership.rows[0].status === 'active', 'BUDGET_OTHER_MEMBERSHIP');
}
export async function budgetDefaults(db, manifest) {
  // Kept in memory for comparison; the receipt retains only its SHA256 and count.
  return (await db.query('select to_jsonb(e) value from public.enrollments e where course_id=$1 order by user_id,id', [manifest.courseId])).rows;
}

/** Explicit preparation only. No default enrollment, identity, role, profile or original course is edited. */
export async function prepareBudgetFixture(manifestFile) {
  const manifest = budgetManifest(manifestFile, false);
  requireBudget(!manifest.budgetFixture, 'BUDGET_ALREADY_PREPARED');
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const bundle = join(manifest.runtime, 'compiled-budget-seed.mjs');
  await build({ entryPoints: [join(repository, 'tests/e2e/real-next-harness/compile-budget-seed.ts')], outfile: bundle,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', absWorkingDir: repository, logLevel: 'silent' });
  chmodSync(bundle, 0o600);
  const { compileBudgetSeed } = await import(pathToFileURL(bundle).href);
  const seed = await compileBudgetSeed();
  requireBudget(seed.compiled.courseId === BUDGET_COURSE_ID && seed.itemId === BUDGET_ITEM_ID, 'BUDGET_COMPILED_ID');
  const db = createStudioFixtureClient(manifest.postgres); await db.connect();
  try {
    await assertBudgetDatabase(db, manifest);
    await db.query('begin');
    const baseline = await budgetDefaults(db, manifest);
    requireBudget((await db.query('select count(*)::int n from public.courses where id=$1', [BUDGET_COURSE_ID])).rows[0].n === 0, 'BUDGET_COURSE_EXISTS');
    const c = seed.compiled;
    await db.query("insert into public.courses(id,slug,owner_id,status) values($1,$1,$2,'published')", [c.courseId, OTHER_ID]);
    await db.query('insert into public.course_versions(id,course_id,version,manifest,checksum,summary,published_by) values($1,$2,1,$3,$4,$5,$6)',
      [VERSION_ID, c.courseId, seed.workspace.manifest, c.checksum, { courseId: c.courseId, checksum: c.checksum, meta: c.meta, outline: c.outline, languages: c.languages, defaultLanguage: c.defaultLanguage }, OTHER_ID]);
    await db.query('update public.courses set current_version_id=$2 where id=$1', [c.courseId, VERSION_ID]);
    await db.query('insert into public.course_version_outline(version_id,course_id,outline,meta,access,completion,skills,languages,default_language) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [VERSION_ID, c.courseId, c.outline, c.meta, c.access, c.completion, JSON.stringify(c.skills), c.languages, c.defaultLanguage]);
    for (const item of Object.values(c.items)) {
      await db.query('insert into public.course_version_items(version_id,item_id,kind,source,grading,checksum) values($1,$2,$3,$4,$5,$6)',
        [VERSION_ID, item.id, item.kind, seed.workspace.items[item.id], item.grading, item.checksum]);
      for (const [locale, payload] of Object.entries(item.renders)) await db.query('insert into public.course_version_item_renders(version_id,item_id,locale,payload) values($1,$2,$3,$4)', [VERSION_ID, item.id, locale, payload]);
    }
    await seedPublishedAuthoringDraft(db,{workspace:seed.workspace,versionId:VERSION_ID,actorId:OTHER_ID});
    await db.query("insert into public.enrollments(user_id,course_id,course_version_id,status) values($1,$2,$3,'active')", [OTHER_ID, c.courseId, VERSION_ID]);
    const newEnrollments = await db.query('select user_id from public.enrollments where course_id=$1', [BUDGET_COURSE_ID]);
    requireBudget(newEnrollments.rows.length === 1 && newEnrollments.rows[0].user_id === OTHER_ID, 'BUDGET_ENROLLMENT_SCOPE');
    requireBudget(digest(JSON.stringify(await budgetDefaults(db, manifest))) === digest(JSON.stringify(baseline)), 'BUDGET_DEFAULTS_CHANGED');
    await db.query('commit');
    const budgetFixture = { actor: 'other', courseId: c.courseId, itemId: seed.itemId, versionId: VERSION_ID,
      simpleQuestionIds: seed.simpleQuestionIds, groupQuestionId: seed.groupQuestionId, groupChildQuestionIds: seed.groupChildQuestionIds,
      shape: seed.shape, compiledChecksum: c.checksum, baselineEnrollmentCount: baseline.length, baselineEnrollmentSha256: digest(JSON.stringify(baseline)) };
    const receipt = join(manifest.runtime, 'budget-preparation.json');
    writeFileSync(receipt, JSON.stringify({ kind: 'synthetic-budget-preparation', ...seed.shape,
      compiledChecksum: c.checksum, baselineEnrollmentCount: baseline.length, baselineEnrollmentSha256: budgetFixture.baselineEnrollmentSha256,
      newEnrollmentCount: 1, originalEnrollmentsUnchanged: true, assessmentRuntimeExecuted: false }) + '\n', { mode: 0o600 });
    const temporary = manifestFile + '.budget.tmp';
    writeFileSync(temporary, JSON.stringify({ ...manifest, budgetFixture }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, manifestFile);
    return { status: 'budget_fixture_prepared', receipt };
  } catch (error) { await db.query('rollback').catch(() => {}); throw error; }
  finally { await db.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareBudgetFixture(resolve(process.argv[2])))); }
  catch { console.error(JSON.stringify({ status: 'budget_preparation_failed', code: 'BUDGET_PREPARATION_FAILED' })); process.exitCode = 1; }
}

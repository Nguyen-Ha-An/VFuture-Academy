#!/usr/bin/env node
// Run only against the disposable, socket-only native PG17 fixture owned by
// rehearseForward55. This entry point accepts no database URL or credentials.
import assert from 'node:assert/strict';
import { canonical, sha256 } from './forward-artifact.mjs';
import { catalogContract, repairArtifact } from './forward-56-artifact.mjs';
import { deriveCatalogContract, readRepairCatalog } from './forward-56-catalog.mjs';
import { createForward56Executor } from './forward-56.mjs';
import { createForward55Executor } from './forward-55.mjs';
import { rehearseForward55, withLocalAcademyDatabase } from './rehearse-forward-55.mjs';

const showCatalog = process.argv.length === 3 && process.argv[2] === '--show-catalog';
if (process.argv.length !== 2 && !showCatalog) throw new Error('Unexpected repair rehearsal arguments');
const upgraded = await rehearseForward55(async ({ db, target, source, activationSha, predecessor }) => {
  const artifact = repairArtifact();
  const teaching = createForward55Executor({ db, target, source, expectedActivationSha: activationSha, expectedPredecessor: predecessor });
  const evidence = { action: 'forward-55-plan', source, plan: await teaching.plan(),
    packageContentSha256: '1'.repeat(64), encryptedPackageSha256: '2'.repeat(64), sourceManifestSha256: '3'.repeat(64) };

  // Discover exactly which definitions change, independent of the declared
  // scope. Use a real completed teacher release and always roll back this pass.
  await db.query('begin');
  const before = await readRepairCatalog(db);
  for (const step of artifact.steps) await db.query(step.sql);
  const after = await readRepairCatalog(db);
  await db.query('rollback');
  const expected = deriveCatalogContract(before, after);
  if (showCatalog) {
    console.log(JSON.stringify(expected, null, 2));
    return;
  }
  assert.deepEqual(catalogContract(), expected, 'Review catalog changes against the SQL using --show-catalog');

  const options = { db, target, source, evidence };
  const executor = createForward56Executor(options);
  const reviewed = await executor.plan();
  assert.equal(reviewed.action, 'apply');
  assert.deepEqual(reviewed.steps, artifact.hashes);
  await db.query(`set quote_all_identifiers=on; set intervalstyle='iso_8601'; set datestyle='German, DMY';
    set timezone='Asia/Ho_Chi_Minh'; set search_path=pg_catalog,public`);
  assert.deepEqual(await executor.plan(),reviewed,'Host formatting preferences do not change the catalog digest');
  assert.deepEqual((await db.query("select current_setting('quote_all_identifiers') q, current_setting('IntervalStyle') i")).rows[0],{q:'on',i:'iso_8601'});
  await db.query('reset quote_all_identifiers; reset intervalstyle; reset datestyle; reset timezone; reset search_path');
  const wrongEvidence = { ...evidence, plan: { ...evidence.plan, receiptSourceTree: 'e'.repeat(40) } };
  await assert.rejects(createForward56Executor({ ...options, evidence: wrongEvidence }).plan());
  await assert.rejects(executor.apply({ ...reviewed, steps: reviewed.steps.slice(1) }));
  await assert.rejects(createForward56Executor({ ...options, verifySource: () => ({ ...source, sourceTree: 'd'.repeat(40) }) }).apply(reviewed));
  const broken = createForward56Executor({ ...options, db: {
    query: (sql, params) => db.query(sql === artifact.steps.at(-1).sql ? 'select 1/0' : sql, params),
  } });
  await assert.rejects(broken.apply(reviewed), error => error.code === '22012');
  assert.deepEqual(await executor.plan(), reviewed, 'Final-step failure rolls back schema, data and receipt');
  assert.equal((await executor.apply(reviewed)).action, 'applied');
  const replay = await executor.plan();
  assert.equal(replay.action, 'noop');
  assert.equal(replay.priorReceiptDigest, reviewed.priorReceiptDigest);
  assert.equal(replay.receiptSourceCommit, source.sourceCommit);
  assert.equal((await executor.apply(replay)).action, 'noop');
  await assert.rejects(executor.apply(reviewed), 'A consumed apply plan must be reviewed again');
  await db.query('grant select(steps) on academy_private.repair_forward_receipt to authenticated');
  await assert.rejects(executor.plan(), 'A column-level grant exposes the private receipt');
  await db.query('revoke select(steps) on academy_private.repair_forward_receipt from authenticated');
  await db.query('create role rehearsal_alternate_owner nologin');
  await db.query('alter table academy_private.repair_forward_receipt owner to rehearsal_alternate_owner');
  await assert.rejects(executor.plan(), 'Receipt ownership must remain with the approved migration account');
  await db.query('alter table academy_private.repair_forward_receipt owner to academy_admin');
  await db.query('alter index public.resources_public_media_ids_idx rename to rehearsal_changed_index');
  await assert.rejects(executor.plan(), 'Drift prevents acknowledging a committed receipt');
  await db.query('alter index public.rehearsal_changed_index rename to resources_public_media_ids_idx');
  assert.equal((await executor.plan()).action, 'noop');

  return expected;
}, showCatalog ? console.error : console.log);
if (upgraded) {
  // Roles are cluster-wide. A second empty cluster exercises the original
  // bootstrap bytes and fresh ACLs after the upgrade cluster has shut down.
  await withLocalAcademyDatabase(async ({db}) => {
    await db.query('begin');
    for (const step of repairArtifact().built.steps) await db.query(step.sql);
    assert.equal(sha256(canonical(await readRepairCatalog(db,upgraded.names))),upgraded.after);
    await db.query('rollback');
  });
  console.log('Local PostgreSQL 17 repair upgrade, atomic rollback, replay, catalog drift and fresh-schema equivalence passed.');
}

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  ASSESSMENT_ACTIONS, FILES_PILOT_CATALOG_SHA256, FILES_PILOT_FILE, FILES_PILOT_SQL_SHA256,
  validateArchiveListing, validateAssessmentReceipt,
} from '../archive-policy.mjs';
import {
  approvedFilesPilotEvidence, forward57Evidence, forward57SourceFiles, validateFilesPilotPlan,
} from '../../../scripts/azure-core/forward-57-artifact.mjs';
import { createFilesPilotExecutor, readFilesPilotSql } from '../../../scripts/azure-core/forward-57.mjs';
import { sha256 } from '../../../scripts/azure-core/forward-artifact.mjs';

const source = { sourceClean: true, sourceCommit: '1'.repeat(40), sourceTree: '2'.repeat(40) };
const evidence = approvedFilesPilotEvidence();
const envelope = {
  action: 'forward-57-plan', source, packageContentSha256: '3'.repeat(64),
  encryptedPackageSha256: '4'.repeat(64), sourceManifestSha256: '5'.repeat(64),
  plan: { action: 'apply', filename: FILES_PILOT_FILE, sqlSha256: FILES_PILOT_SQL_SHA256,
    targetSha256: '6'.repeat(64), catalogSha256: null },
};

test('Files pilot action packages exactly one pinned migration and rejects alternate reviewed plans', () => {
  assert.equal(ASSESSMENT_ACTIONS['forward-57-plan'].mode, 'plan');
  assert.equal(ASSESSMENT_ACTIONS['forward-57-apply'].mode, 'apply');
  assert.equal(sha256(readFilesPilotSql()), FILES_PILOT_SQL_SHA256);
  const paths = forward57SourceFiles();
  assert.deepEqual(paths.filter(path => path.endsWith('.sql')), ['supabase/migrations/' + FILES_PILOT_FILE]);
  assert.deepEqual(validateArchiveListing(paths.join('\n')), { files: paths.length });
  assert.throws(() => validateArchiveListing(paths.join('\n') + '\n./scripts/azure-core/custom-sql.mjs'));
  assert.deepEqual(forward57Evidence(evidence), evidence);
  assert.deepEqual(validateFilesPilotPlan(envelope, evidence, source), envelope);
  assert.throws(() => validateFilesPilotPlan(envelope, { migration: 'different.sql', sqlSha256: FILES_PILOT_SQL_SHA256 }, source));
  assert.throws(() => validateFilesPilotPlan(envelope, evidence, { ...source, sourceTree: 'a'.repeat(40) }));
  assert.throws(() => validateFilesPilotPlan({ ...envelope, plan: { ...envelope.plan, sqlSha256: 'b'.repeat(64) } }, evidence, source));
  assert.throws(() => validateFilesPilotPlan({ ...envelope, plan: { ...envelope.plan, catalogSha256: 'c'.repeat(64) } }, evidence, source));
  const { plan: _plan, ...receiptBase } = envelope;
  const receipt = {
    ...receiptBase, action: 'forward-57-apply', outcome: 'applied', filename: FILES_PILOT_FILE,
    sqlSha256: FILES_PILOT_SQL_SHA256, catalogSha256: FILES_PILOT_CATALOG_SHA256,
  };
  assert.deepEqual(validateAssessmentReceipt(receipt, 'forward-57-apply', { transport: true }), receipt);
  assert.throws(() => validateAssessmentReceipt({ ...receipt, outcome: 'skipped' }, 'forward-57-apply', { transport: true }));
});

test('Files pilot transaction plans read-only, applies once, replays safely and rejects grant drift in PostgreSQL 17', {
  skip: !process.env.FILES_PILOT_PG17_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.FILES_PILOT_PG17_MODULE).href);
  const folder = mkdtempSync(join(tmpdir(), 'academy-files-pilot-pg17-'));
  let db;
  try {
    db = new PGlite(folder);
    await db.exec('create database academy');
    await db.close();
    db = new PGlite(folder, { database: 'academy' });
    await db.exec(`
      create role academy_admin;
      create role anon;
      create role authenticated;
      create role service_role nologin bypassrls;
      grant usage,create on schema public to academy_admin;
      grant usage on schema public to service_role;
      create schema academy_private authorization academy_admin;
      set role academy_admin;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
      alter default privileges in schema public grant all on tables to service_role;
      create table public.resources(id text primary key);
      create table academy_private.migration_state(singleton boolean primary key, state text, schema_sha256 text);
      insert into academy_private.migration_state values (true,'imported','273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149');
    `);
    const operations = [];
    const driver = {
      query(sql, values) {
        operations.push(sql);
        // node-postgres sends the pinned multi-statement SQL via its simple protocol.
        return sql === readFilesPilotSql() ? db.exec(sql) : db.query(sql, values);
      },
    };
    const executor = createFilesPilotExecutor({
      db: driver, targetHost: 'fixture.postgres.database.azure.com', verifySource() {},
    });
    const plan = await executor.plan();
    assert.equal(plan.action, 'apply');
    assert.equal(plan.catalogSha256, null);
    assert.equal(operations[0], 'begin isolation level repeatable read read only');
    assert.equal(operations.at(-1), 'rollback');
    assert(!operations.includes(readFilesPilotSql()));
    await assert.rejects(executor.apply({ ...plan, targetSha256: '0'.repeat(64) }));
    assert.equal((await db.query("select to_regclass('public.resource_files_pilot') is null as absent")).rows[0].absent, true);
    assert.deepEqual(await executor.apply(plan), { outcome: 'applied', catalogSha256: FILES_PILOT_CATALOG_SHA256 });
    assert.deepEqual(await executor.apply(plan), { outcome: 'noop', catalogSha256: FILES_PILOT_CATALOG_SHA256 });
    assert.equal(operations.filter(sql => sql === readFilesPilotSql()).length, 1);
    await db.exec('grant select on public.resource_files_pilot to authenticated');
    await assert.rejects(executor.plan(), /Academy Files pilot migration failed/);
  } finally {
    await db?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

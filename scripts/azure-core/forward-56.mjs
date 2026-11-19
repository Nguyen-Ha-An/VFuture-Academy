import { createAzureTargetClient } from './target.mjs';
import { canonical, cleanSource, sha256 } from './forward-artifact.mjs';
import { inspectAppliedForward55 } from './forward-55.mjs';
import { catalogContract, forward56Evidence, repairArtifact, teachingReceiptFields } from './forward-56-artifact.mjs';
import { configureCatalogSession, readRepairCatalog } from './forward-56-catalog.mjs';

const receiptTable = 'academy_private.repair_forward_receipt';
async function priorReceipt(db, evidence, source) {
  const reviewed = evidence.plan;
  const previous = { verified: true, activationSha: reviewed.activationSha, predecessor: reviewed.predecessor };
  const current = await inspectAppliedForward55(db, previous, source);
  // Current learner and teacher counts naturally change after release. Compare
  // the historical receipt and role/SQL boundaries checked by the prior job.
  for (const key of ['priorReceiptDigest','roleCount','roleDigest','receiptSourceCommit','receiptSourceTree']) same(current[key],reviewed[key]);
  const rows = (await db.query(`select ${teachingReceiptFields},applied_at from academy_private.teaching_forward_receipt where singleton`)).rows;
  if (rows.length !== 1) throw new Error('Missing teacher release receipt');
  return sha256(canonical(rows[0]));
}
function same(actual, expected) {
  if (canonical(actual) !== canonical(expected)) throw new Error('Repair release evidence changed');
}
async function inspect(db, release) {
  const { artifact, evidence, source, contract } = release;
  const priorReceiptDigest = await priorReceipt(db, evidence, source);
  const { present } = (await db.query('select to_regclass($1) is not null as present', [receiptTable])).rows[0];
  const catalogSha256 = sha256(canonical(await readRepairCatalog(db, contract.names)));
  const plan = {
    action: present ? 'noop' : 'apply', filename: evidenceFilename(artifact), steps: artifact.hashes, source,
    evidenceSha256: sha256(canonical(evidence)), priorReceiptDigest, catalogSha256,
  };
  same(catalogSha256, present ? contract.after : contract.before);
  if (!present) return plan;
  const { protected_receipt } = (await db.query(`select c.relrowsecurity and c.relkind='r'
    and c.relowner=current_user::regrole
    and not exists (select 1 from pg_policy where polrelid=c.oid)
    and not exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a where a.grantee<>c.relowner)
    and not exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and cardinality(a.attacl)>0)
    and exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid=c.oid and a.attname='singleton'
      where k.conrelid=c.oid and k.contype='p' and k.conkey=array[a.attnum] and k.convalidated
        and a.atttypid='boolean'::regtype and a.attnotnull)
    and exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='c'
      and k.convalidated and pg_get_expr(k.conbin,k.conrelid)='singleton')
    as protected_receipt from pg_class c where c.oid=$1::regclass`, [receiptTable])).rows[0];
  if (!protected_receipt) throw new Error('Repair receipt access changed');
  const rows = (await db.query(`select filename,steps,prior_receipt_digest,evidence_sha256,catalog_sha256,source_commit,source_tree from ${receiptTable}`)).rows;
  if (rows.length !== 1) throw new Error('Invalid repair receipt');
  const { source_commit, source_tree, ...recorded } = rows[0];
  if (!cleanSource({ sourceClean: true, sourceCommit: source_commit, sourceTree: source_tree })) throw new Error('Invalid recorded repair provenance');
  same(recorded, { filename: plan.filename, steps: plan.steps, prior_receipt_digest: priorReceiptDigest, evidence_sha256: plan.evidenceSha256, catalog_sha256: catalogSha256 });
  return { ...plan, receiptSourceCommit: source_commit, receiptSourceTree: source_tree };
}
function evidenceFilename(artifact) {
  return artifact.hashes[0].file.slice('supabase/migrations/'.length);
}
export function createForward56Executor({ db, target, evidence, source, verifySource }) {
  createAzureTargetClient(target);
  if (!cleanSource(source)) throw new Error('Clean repair release source required');
  const release = { artifact: repairArtifact(), evidence: forward56Evidence(evidence), source: { ...source }, contract: catalogContract() };
  async function transaction(readOnly, work) {
    try {
      await db.query(readOnly ? 'begin isolation level repeatable read read only' : 'begin');
      await db.query(readOnly ? "set local statement_timeout='15000ms'" : "set local statement_timeout='120000ms'");
      await configureCatalogSession(db);
      const result = await work();
      await db.query(readOnly ? 'rollback' : 'commit');
      return result;
    } catch (error) {
      try { await db.query('rollback'); } catch { /* A disconnected client cannot retain uncommitted work. */ }
      const failure = new Error('Azure repair migration failed');
      if (/^[0-9A-Z]{5}$/.test(error?.code ?? '')) failure.code = error.code;
      throw failure;
    }
  }
  return {
    plan: () => transaction(true, () => inspect(db, release)),
    apply: reviewed => transaction(false, async () => {
      await db.query("set local lock_timeout='5000ms'");
      await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
      await db.query(`lock table public.authorization_guard,public.role_definitions,academy_private.migration_state,
        academy_private.canvas_forward_receipts,academy_private.assessment_forward_receipt,
        academy_private.handle_forward_receipt,academy_private.teaching_forward_receipt in share mode`);
      if (verifySource) same(await verifySource(), release.source);
      const current = await inspect(db, release);
      same(current, reviewed);
      if (current.action === 'noop') return { action: 'noop', filename: current.filename };
      for (const step of release.artifact.steps) await db.query(step.sql);
      await db.query(`create table ${receiptTable} (
        singleton boolean primary key default true check(singleton), filename text not null, steps jsonb not null,
        prior_receipt_digest text not null, evidence_sha256 text not null, catalog_sha256 text not null,
        source_commit text not null, source_tree text not null, applied_at timestamptz not null default now()
      ); alter table ${receiptTable} enable row level security; revoke all on ${receiptTable} from public,anon,authenticated,service_role`);
      await db.query(`insert into ${receiptTable}
        (filename,steps,prior_receipt_digest,evidence_sha256,catalog_sha256,source_commit,source_tree)
        values($1,$2::jsonb,$3,$4,$5,$6,$7)`, [current.filename, JSON.stringify(current.steps), current.priorReceiptDigest,
        current.evidenceSha256, release.contract.after, release.source.sourceCommit, release.source.sourceTree]);
      const after = await inspect(db, release);
      same(after, { ...current, action: 'noop', catalogSha256: release.contract.after,
        receiptSourceCommit: release.source.sourceCommit, receiptSourceTree: release.source.sourceTree });
      if (verifySource) same(await verifySource(), release.source);
      await db.query("notify pgrst, 'reload schema'");
      return { action: 'applied', filename: current.filename };
    }),
  };
}

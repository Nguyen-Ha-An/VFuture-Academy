import { readFileSync } from 'node:fs';
import { REPAIR_FILES, REPAIR_MIGRATIONS, validateAssessmentReceipt } from '../../infra/azure-core/archive-policy.mjs';
import { canonical, createBoundedManifest, sha256, verifyBoundedArtifact } from './forward-artifact.mjs';
import { FORWARD55_BOUNDARY, forward55Evidence, validateForward55ReviewedPlan } from './forward-55-artifact.mjs';
import { buildAzureSchema } from './schema.mjs';

export const FORWARD56_BOUNDARY = REPAIR_MIGRATIONS.at(-1);
export const FORWARD56_EVIDENCE = 'build/azure-core/private/forward-56-v1-evidence.json';
export const FORWARD56_MANIFEST = 'build/azure-core/private/forward-56-source-manifest.json';
export const FORWARD56_PLAN = 'build/azure-core/private/forward-56-plan.json';
export const teachingReceiptFields = 'filename,migrations,identity_sha256,prior_receipt_digest,baseline_role_digest,applied_role_digest,source_commit,source_tree';
const predecessorSchemaHash = '6252d759db0d6f14fc5178954aacd861b553fbc609dcd7c4508e7ad2ea4ab342';
export const catalogContract = () => JSON.parse(readFileSync(new URL('forward-56-catalog.json', import.meta.url), 'utf8'));
const pathForStep = id => id.includes('/') ? id : 'scripts/azure-core/' + id;

export function repairArtifact() {
  const prior = buildAzureSchema({ through: FORWARD55_BOUNDARY });
  if (prior.receipt.schemaSha256 !== predecessorSchemaHash) throw new Error('Historical teaching release SQL changed');
  const built = buildAzureSchema({ through: FORWARD56_BOUNDARY });
  const added = built.receipt.migrations.slice(prior.receipt.migrations.length);
  if (canonical(added.map(entry => entry.file)) !== canonical(REPAIR_MIGRATIONS)) throw new Error('Unexpected repair migration inventory');
  const priorSteps = new Set(prior.steps.map(step => step.id));
  const steps = built.steps.filter(step => !priorSteps.has(step.id)).map(({ id, sql }) => {
    const file = pathForStep(id);
    const migration = added.find(entry => file === 'supabase/migrations/' + entry.file);
    const sourceSha256 = migration?.sourceSha256 ?? sha256(sql);
    return { file, sql, sourceSha256, azureSha256: migration?.azureSha256 ?? sourceSha256 };
  });
  if (canonical(steps.map(step => step.file)) !== canonical(REPAIR_FILES)) throw new Error('Unexpected repair SQL steps');
  return { built, steps, hashes: steps.map(({ file, sourceSha256, azureSha256 }) => ({ file, sourceSha256, azureSha256 })) };
}
export function forward56SourceFiles() {
  const { built } = repairArtifact();
  return [
    'package.json', 'package-lock.json', 'infra/azure-core/postgres-roots.crt', 'infra/azure-core/archive-policy.mjs',
    ...['schema.mjs', 'target.mjs', 'forward-artifact.mjs', 'forward-53.mjs', 'forward-55.mjs',
      'forward-55-inventory.mjs', 'forward-55-artifact.mjs', 'baselines/identity-pre-handles.sql', 'baselines/identity-post-handles.sql',
      'forward-56.mjs', 'forward-56-job.mjs', 'forward-56-artifact.mjs', 'forward-56-catalog.mjs', 'forward-56-catalog.json']
      .map(name => 'scripts/azure-core/' + name),
    ...built.steps.map(step => pathForStep(step.id)),
  ].sort();
}
export function forward56Evidence(value) {
  // The immutable post55 read-only plan carries the checked prior chain, role
  // and committed receipt provenance. A short apply acknowledgement lacks them.
  validateAssessmentReceipt(value, 'forward-55-plan', { transport: true });
  if (value.plan.action !== 'noop') throw new Error('Completed teacher release evidence required');
  const previous = forward55Evidence({ verified: true, activationSha: value.plan.activationSha, predecessor: value.plan.predecessor });
  const built = buildAzureSchema({ through: FORWARD55_BOUNDARY });
  if (built.receipt.schemaSha256 !== predecessorSchemaHash) throw new Error('Historical teaching release SQL changed');
  validateForward55ReviewedPlan(value, previous, { entry: built.receipt.migrations[54], source: value.source });
  return value;
}
export function validateRepairPlan(envelope, evidence, source) {
  validateAssessmentReceipt(envelope, 'forward-56-plan', { transport: true });
  const { plan } = envelope;
  if (plan.evidenceSha256 !== sha256(canonical(forward56Evidence(evidence))) || canonical(envelope.source) !== canonical(source)
    || canonical(plan.steps) !== canonical(repairArtifact().hashes)
    || plan.catalogSha256 !== catalogContract()[plan.action === 'noop' ? 'after' : 'before']) {
    throw new Error('Repair plan differs from the reviewed source or predecessor');
  }
  return envelope;
}
const release56 = {
  kind: 'forward-56-source-v1', sourceFiles: forward56SourceFiles, validateEvidence: forward56Evidence, validatePlan: validateRepairPlan,
  manifestPath: FORWARD56_MANIFEST, evidencePath: FORWARD56_EVIDENCE, planPath: FORWARD56_PLAN,
  metadata: evidence => ({ activationSha: evidence.plan.activationSha, schemaSha256: repairArtifact().built.receipt.schemaSha256 }),
};
export function createForward56ArtifactManifest(options) { return createBoundedManifest(release56, options); }
export function verifyForward56Artifact(root) { return verifyBoundedArtifact(release56, root); }

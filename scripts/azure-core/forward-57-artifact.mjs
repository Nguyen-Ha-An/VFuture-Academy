import { FILES_PILOT_FILE, FILES_PILOT_SQL_SHA256, validateAssessmentReceipt } from '../../infra/azure-core/archive-policy.mjs';
import { canonical, createBoundedManifest, verifyBoundedArtifact } from './forward-artifact.mjs';
import { readFilesPilotSql } from './forward-57.mjs';

export const FORWARD57_BOUNDARY = FILES_PILOT_FILE;
export const FORWARD57_EVIDENCE = 'build/azure-core/private/forward-57-v1-evidence.json';
export const FORWARD57_MANIFEST = 'build/azure-core/private/forward-57-source-manifest.json';
export const FORWARD57_PLAN = 'build/azure-core/private/forward-57-plan.json';

export function approvedFilesPilotEvidence() {
  return { migration: FILES_PILOT_FILE, sqlSha256: FILES_PILOT_SQL_SHA256 };
}

export function forward57Evidence(value) {
  readFilesPilotSql();
  const expected = approvedFilesPilotEvidence();
  if (canonical(value) !== canonical(expected)) throw new Error('Unexpected Files pilot migration evidence');
  return expected;
}

export function forward57SourceFiles() {
  return [
    'package.json', 'package-lock.json', 'infra/azure-core/postgres-roots.crt', 'infra/azure-core/archive-policy.mjs',
    ...['target.mjs', 'forward-artifact.mjs', 'forward-57.mjs', 'forward-57-job.mjs', 'forward-57-artifact.mjs']
      .map(file => 'scripts/azure-core/' + file),
    'supabase/migrations/' + FILES_PILOT_FILE,
  ].sort();
}

export function validateFilesPilotPlan(envelope, evidence, source) {
  forward57Evidence(evidence);
  validateAssessmentReceipt(envelope, 'forward-57-plan', { transport: true });
  if (canonical(envelope.source) !== canonical(source)) throw new Error('Files pilot reviewed source differs');
  return envelope;
}

const release = {
  kind: 'forward-57-source-v1',
  sourceFiles: forward57SourceFiles,
  validateEvidence: forward57Evidence,
  validatePlan: validateFilesPilotPlan,
  manifestPath: FORWARD57_MANIFEST,
  evidencePath: FORWARD57_EVIDENCE,
  planPath: FORWARD57_PLAN,
  metadata: evidence => ({ sqlSha256: evidence.sqlSha256 }),
};

export function createForward57ArtifactManifest(options) {
  return createBoundedManifest(release, options);
}

export function verifyForward57Artifact(root) {
  return verifyBoundedArtifact(release, root);
}

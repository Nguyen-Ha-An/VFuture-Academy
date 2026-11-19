import { assertForward53Source } from './forward-53-provenance.mjs';
import { validateRepairPlan } from './forward-56-artifact.mjs';

// Recheck local committed provenance on both sides of plan/SQL validation.
export function createForward56PackageManifest(envelope, { v1Evidence, provenanceOptions } = {}) {
  const source = assertForward53Source(envelope?.source, provenanceOptions);
  validateRepairPlan(envelope, v1Evidence, source);
  assertForward53Source(source, provenanceOptions);
}

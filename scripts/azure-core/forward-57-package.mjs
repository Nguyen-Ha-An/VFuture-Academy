import { assertForward53Source } from './forward-53-provenance.mjs';
import { validateFilesPilotPlan } from './forward-57-artifact.mjs';

export function createForward57PackageManifest(envelope, { v1Evidence, provenanceOptions } = {}) {
  const source = assertForward53Source(envelope?.source, provenanceOptions);
  validateFilesPilotPlan(envelope, v1Evidence, source);
  assertForward53Source(source, provenanceOptions);
}

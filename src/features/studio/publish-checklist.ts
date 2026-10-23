import type { Diagnostic, ValidationReport } from '@/content-engine/diagnostics';

/**
 * The single source for the course publish checklist. The server schema in drafts.ts, the
 * reviewer's "Approve and publish" confirmation and the workspace readiness card all read it.
 * Keys are the stored checklist fields; each item also names the diagnostics that check it.
 */
export const PUBLISH_CHECKLIST_KEYS = [
  'outcomesReviewed',
  'answerKeysVerified',
  'accessibilityReviewed',
  'ageAppropriate',
  'linksValid',
  'warningsAcknowledged',
] as const;
export type PublishChecklistKey = (typeof PUBLISH_CHECKLIST_KEYS)[number];
export type PublishChecklist = Record<PublishChecklistKey, boolean>;

/**
 * How an item is checked in the workspace:
 * - `diagnostics`: the validator codes that fail (errors) or flag (warnings) it;
 * - `warnings`: every warning in the report;
 * - `manual`: a person decides; never ticked automatically (the reviewer confirms it).
 */
export type PublishCheckDefinition =
  | { key: PublishChecklistKey; kind: 'diagnostics'; codes: readonly string[]; codePrefix?: string }
  | { key: PublishChecklistKey; kind: 'warnings' }
  | { key: PublishChecklistKey; kind: 'manual' };

export const PUBLISH_CHECKS = [
  { key: 'outcomesReviewed', kind: 'diagnostics', codes: ['W_NO_OBJECTIVES'] },
  { key: 'answerKeysVerified', kind: 'diagnostics', codes: [], codePrefix: 'E_ANSWER_' },
  { key: 'accessibilityReviewed', kind: 'diagnostics', codes: ['W_NO_ALT_TEXT'] },
  { key: 'linksValid', kind: 'diagnostics', codes: ['E_REF_UNRESOLVED'] },
  { key: 'warningsAcknowledged', kind: 'warnings' },
  { key: 'ageAppropriate', kind: 'manual' },
] as const satisfies readonly PublishCheckDefinition[];

export function emptyPublishChecklist(): PublishChecklist {
  return Object.fromEntries(PUBLISH_CHECKLIST_KEYS.map((key) => [key, false])) as PublishChecklist;
}

export function isPublishChecklistComplete(checklist: PublishChecklist): boolean {
  return PUBLISH_CHECKLIST_KEYS.every((key) => checklist[key] === true);
}

/** Publishing needs an error-free report and every checklist item confirmed. */
export function isPublishReady(report: ValidationReport, checklist: PublishChecklist): boolean {
  return report.errors.length === 0 && isPublishChecklistComplete(checklist);
}

/**
 * `unverified`: no report for the text on screen yet, so an automatic item is neither passing
 * nor failing. Only `pass` counts toward readiness.
 */
export type PublishCheckState = 'pass' | 'fail' | 'warn' | 'manual' | 'unverified';

export type PublishCheckResult = {
  key: PublishChecklistKey;
  kind: PublishCheckDefinition['kind'];
  state: PublishCheckState;
  /** Matching diagnostics (for `warnings`, every warning). */
  diagnostics: Diagnostic[];
};

export type PublishReadiness = {
  items: PublishCheckResult[];
  passing: number;
  total: number;
  /** The report was computed from the current revision, so automatic states are real. */
  current: boolean;
};

function matches(definition: Extract<PublishCheckDefinition, { kind: 'diagnostics' }>, diagnostic: Diagnostic): boolean {
  const code = String(diagnostic.code);
  return definition.codes.includes(code) || (definition.codePrefix !== undefined && code.startsWith(definition.codePrefix));
}

/**
 * Evaluates the checklist against a validation report. The report only counts when it belongs to
 * `revision` (the text on screen): a missing report, a report for another revision, or a missing
 * revision leaves every automatic item `unverified`, so nothing shows as passing on stale data.
 */
export function evaluatePublishReadiness(report: ValidationReport | null | undefined, revision: string | null | undefined): PublishReadiness {
  const current = Boolean(report && revision && report.revision === revision);
  const items = PUBLISH_CHECKS.map((definition): PublishCheckResult => {
    const check = definition as PublishCheckDefinition;
    if (check.kind === 'manual') return { key: check.key, kind: check.kind, state: 'manual', diagnostics: [] };
    if (!current || !report) return { key: check.key, kind: check.kind, state: 'unverified', diagnostics: [] };
    if (check.kind === 'warnings') {
      return { key: check.key, kind: check.kind, state: report.warnings.length ? 'warn' : 'pass', diagnostics: [...report.warnings] };
    }
    const errors = report.errors.filter((diagnostic) => matches(check, diagnostic));
    const warnings = report.warnings.filter((diagnostic) => matches(check, diagnostic));
    const state: PublishCheckState = errors.length ? 'fail' : warnings.length ? 'warn' : 'pass';
    return { key: check.key, kind: check.kind, state, diagnostics: [...errors, ...warnings] };
  });
  return { items, passing: items.filter((item) => item.state === 'pass').length, total: items.length, current };
}

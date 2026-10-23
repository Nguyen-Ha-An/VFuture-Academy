import { validateDocument } from '../validate/structural';
import { checkQuestion } from '../validate/semantic/answers';
import { checkIds } from '../validate/semantic/ids';
import { checkStructure } from '../validate/semantic/structure';
import { checkL10n } from '../validate/semantic/l10n';
import { checkHosts } from '../validate/semantic/hosts';
import { checkStandaloneRendererSupport } from '../validate/standalone-renderer';
import { parseWorkspace } from '../validate/workspace';
import { forEachQuestion, itemEntriesOf } from '../validate/walk';
import { itemRef, type Diagnostic } from '../diagnostics';
import type { AuthoringKind, ProfileContext } from './context';
import { PROFILE_MESSAGES } from './codes';
import { schemaForAuthoring } from './json-schema';
import { grandfatherLegacy } from './legacy';
import { checkAuthoringSemantics, type AuthoringIssue } from './semantic';

export { profileContextFromDraft, staticProfileContext } from './context';
export type { AuthoringKind, ProfileContext, ProfileContextOptions, LanguageMode } from './context';
export { schemaForAuthoring, authoringJsonSchema, authoringQuestionJsonSchema, authoringBlockJsonSchema } from './json-schema';
export { authoringGuide, authoringGuideTopic, AUTHORING_GUIDE_TOPICS } from './guide';
export { PROFILE_RULES, criticalProfileRules } from './rules';
export { authoringProfileVersion, AUTHORING_STORAGE_BASELINE } from './fingerprint';
export type { AuthoringIssue } from './semantic';

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const pointer = (path: readonly PropertyKey[]) =>
  path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
const kindOf = (value: unknown): AuthoringKind | null => {
  const kind = asObject(value)?.kind;
  return kind === 'lesson' || kind === 'exam' || kind === 'assignment' ? kind : null;
};

/** Storage diagnostics are recast as fixed English messages without source text. */
function storageIssues(diagnostics: Diagnostic[]): AuthoringIssue[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    path: diagnostic.path,
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    message: diagnostic.severity === 'error'
      ? 'Document fails Studio storage validation.'
      : 'Studio storage validation returned a warning.',
  }));
}

function profileIssues(document: unknown, kind: AuthoringKind, context: ProfileContext): AuthoringIssue[] {
  const result = schemaForAuthoring(kind, context).safeParse(document);
  if (result.success) return [];
  const issues: AuthoringIssue[] = [];
  for (const issue of result.error.issues) {
    const paths = issue.code === 'unrecognized_keys' && 'keys' in issue
      ? (issue.keys as string[]).map((key) => [...issue.path, key])
      : [issue.path];
    for (const path of paths) {
      issues.push({
        code: 'E_PROFILE_SCHEMA',
        path: pointer(path),
        severity: 'error',
        message: PROFILE_MESSAGES.E_PROFILE_SCHEMA,
        legacyMode: issue.code === 'unrecognized_keys' ? 'value' : 'node',
      });
    }
  }
  return issues;
}

function targetIssues(document: unknown, context: ProfileContext): AuthoringIssue[] {
  const row = asObject(document);
  if (!row) return [];
  if (context.target) {
    const issues: AuthoringIssue[] = [];
    if (row.kind !== context.target.kind) issues.push({
      code: 'E_PROFILE_TARGET_MISMATCH', path: '/kind', severity: 'error',
      message: PROFILE_MESSAGES.E_PROFILE_TARGET_MISMATCH, legacyMode: 'none',
    });
    if (row.id !== context.target.id) issues.push({
      code: 'E_PROFILE_TARGET_MISMATCH', path: '/id', severity: 'error',
      message: PROFILE_MESSAGES.E_PROFILE_TARGET_MISMATCH, legacyMode: 'none',
    });
    return issues;
  }
  if (typeof row.id === 'string' && context.existingItemIds.includes(row.id)) return [{
    code: 'E_PROFILE_ITEM_ID_TAKEN', path: '/id', severity: 'error',
    message: PROFILE_MESSAGES.E_PROFILE_ITEM_ID_TAKEN, legacyMode: 'none',
  }];
  return [];
}

function delegatedChecks(document: unknown, context: ProfileContext): AuthoringIssue[] {
  const id = asObject(document)?.id;
  const reference = itemRef(typeof id === 'string' ? id : 'item');
  const validated = validateDocument(document, reference);
  if (!validated.ok) return storageIssues(validated.diagnostics);
  if (validated.kind !== 'lesson' && validated.kind !== 'exam' && validated.kind !== 'assignment') return [];

  const diagnostics: Diagnostic[] = [...checkStandaloneRendererSupport(validated.doc, reference)];
  if (validated.kind === 'lesson' || validated.kind === 'exam') {
    for (const scope of itemEntriesOf(validated.doc)) {
      forEachQuestion(scope.entries, scope.path, ({ question, path, parentPath }) => {
        if (!parentPath) diagnostics.push(...checkQuestion(question, path, reference));
      });
    }
  }
  if (context.sourceDraft && typeof id === 'string') {
    const replaced = { ...context.sourceDraft, items: { ...context.sourceDraft.items, [id]: document } };
    const workspace = parseWorkspace(replaced);
    if (!workspace.ok || !workspace.parsed) return [
      ...storageIssues(diagnostics),
      { code: 'E_PROFILE_CONTEXT_INVALID', path: '', severity: 'error', message: PROFILE_MESSAGES.E_PROFILE_CONTEXT_INVALID },
    ];
    const parsed = workspace.parsed;
    diagnostics.push(...[
      ...checkIds(parsed), ...checkStructure(parsed), ...checkL10n(parsed), ...checkHosts(parsed),
    ].filter((diagnostic) => diagnostic.ref?.kind === 'course'
      || (diagnostic.ref?.kind === 'item' && diagnostic.ref.id === id)));
  }
  return storageIssues(diagnostics);
}

/** Strict profile, Studio storage, semantic rules, then unchanged legacy passthrough. */
export function checkAuthoringProfile(document: unknown, base: unknown, context: ProfileContext): {
  ok: boolean; errors: AuthoringIssue[]; warnings: AuthoringIssue[];
} {
  const kind = kindOf(document);
  const storage = delegatedChecks(document, context);
  const identity = targetIssues(document, context);
  const profile = kind ? profileIssues(document, kind, context) : [];
  const semantic = checkAuthoringSemantics(document, context);
  const unsupported: AuthoringIssue[] = kind ? [] : [{
    code: 'E_PROFILE_SCHEMA', path: '/kind', severity: 'error',
    message: 'Only lesson, exam, and assignment items can use the authoring profile.',
  }];
  const all = [
    ...storage,
    ...identity,
    ...unsupported,
    ...grandfatherLegacy([...profile, ...semantic], document, base),
  ];
  const errors = all.filter((issue) => issue.severity === 'error');
  const warnings = all.filter((issue) => issue.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

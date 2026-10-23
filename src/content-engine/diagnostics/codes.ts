import type { Severity } from './types';

export const CODES = {
  E_JSON_PARSE: 'error', E_JSON_DUPLICATE_KEY: 'error', E_JSON_NUMBER_RANGE: 'error', E_JSON_ROOT_NOT_OBJECT: 'error', E_UNKNOWN_KIND: 'error', E_SCHEMA_VERSION_UNSUPPORTED: 'error', E_SCHEMA: 'error', E_ID_FORMAT: 'error', E_DUPLICATE_ID: 'error',
  E_MISSING_ITEM_DOCUMENT: 'error', E_ITEM_KIND_MISMATCH: 'error', W_ORPHAN_ITEM_DOCUMENT: 'warning', W_STUB_METADATA_MISMATCH: 'warning',
  E_WORKSPACE_ID_MISMATCH: 'error', E_ITEM_ID_MISMATCH: 'error', E_ITEM_NOT_DECLARED: 'error', E_ORPHAN_ITEM_DOCUMENT: 'error', E_DUPLICATE_ITEM_DOCUMENT: 'error',
  E_NESTING_TOO_DEEP: 'error', E_LIMIT_EXCEEDED: 'error',
  E_AUTO_TYPE_MISSING_KEY: 'error', W_IGNORED_ANSWER_KEY: 'warning', E_ANSWER_SHAPE: 'error', E_ANSWER_REF_UNKNOWN: 'error', E_OPTIONS_TOO_FEW: 'error', E_QUIZ_MANUAL_QUESTION: 'error',
  E_BLANK_UNDECLARED: 'error', E_BLANK_UNUSED: 'error', E_BLANK_OUTSIDE_FILL_BLANK: 'error', E_ORDERING_NOT_PERMUTATION: 'error',
  E_PLAYER_UNKNOWN: 'error', E_RENDERER_UNSUPPORTED: 'error',
  E_REF_UNRESOLVED: 'error', E_REFERENCE_LOOKUP_FAILED: 'error', E_POOL_UNSATISFIABLE: 'error', E_POOL_SPEC: 'error',
  E_COMPLETION_TARGET_UNKNOWN: 'error', E_NEXT_STEP_TARGET_UNKNOWN: 'error', E_PREREQ_SELF: 'error',
  E_L10N_MISSING_DEFAULT: 'error', E_L10N_UNKNOWN_LOCALE: 'error', W_L10N_MISSING_TRANSLATION: 'warning', W_L10N_LANGUAGE_OVERRIDE: 'warning',
  E_MEDIA_HOST_NOT_ALLOWED: 'error', E_EMBED_HOST_NOT_ALLOWED: 'error', W_EXTERNAL_MEDIA: 'warning', E_ASSET_UNKNOWN: 'error',
  E_RESOURCE_UNKNOWN: 'error', E_OPPORTUNITY_UNKNOWN: 'error', E_BRANCH_UNKNOWN: 'error', E_RESOURCE_ACTIVITY_BLOCK: 'error',
  W_NO_OBJECTIVES: 'warning', W_NO_EXPLANATION: 'warning', W_NO_ALT_TEXT: 'warning', W_LESSON_TOO_LONG: 'warning', W_LESSON_NO_ACTIVITY: 'warning',
  W_COURSE_NO_OUTPUT: 'warning', W_COURSE_NO_NEXT_STEP: 'warning', W_COURSE_NO_SKILLS: 'warning', W_EXAM_NO_TIME_LIMIT: 'warning',
  W_DUPLICATE_OPTION_TEXT: 'warning', W_POINTS_ZERO: 'warning',
} as const satisfies Record<string, Severity>;
export type DiagnosticCode = keyof typeof CODES;

/** Messages are fixed prose; authored text and IDs never enter diagnostic messages. */
export const PROFILE_MESSAGES = {
  E_PROFILE_SCHEMA: 'Document violates the strict authoring profile.',
  E_PROFILE_TARGET_MISMATCH: 'The item id and kind must match the selected edit target.',
  E_PROFILE_ITEM_ID_TAKEN: 'This item id already exists in the course.',
  E_PROFILE_CONTEXT_INVALID: 'The course draft could not be checked against the storage contract.',
  W_PROFILE_LEGACY_UNCHANGED: 'Unchanged legacy profile violation; keep this construct verbatim.',
} as const;

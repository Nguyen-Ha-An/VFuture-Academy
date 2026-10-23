export type ProfileLookup = {
  data: { handle: string | null } | null;
  error: unknown | null;
};

/**
 * A profile row with an explicit null handle is the only onboarding state.
 * Failed or empty reads must not be mistaken for a new account.
 */
export function profileState(result: ProfileLookup): 'complete' | 'incomplete' | 'unavailable' {
  if (result.error || !result.data) return 'unavailable';
  return result.data.handle === null ? 'incomplete' : 'complete';
}

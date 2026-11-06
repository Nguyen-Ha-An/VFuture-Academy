export type ProfileLookup = {
  data: { handle: string | null; display_name: string } | null;
  error: unknown | null;
};

/**
 * Authentication allocates the handle. Only a missing name needs user input;
 * a failed lookup or missing managed handle needs a retry instead.
 */
export function profileState(result: ProfileLookup): 'complete' | 'incomplete' | 'unavailable' {
  if (result.error || !result.data || !result.data.handle || typeof result.data.display_name !== 'string') return 'unavailable';
  return result.data.display_name.trim() ? 'complete' : 'incomplete';
}
